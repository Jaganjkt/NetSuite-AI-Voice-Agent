/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @description LLM Orchestration Layer — manages multi-turn tool-augmented conversations with N/llm GPT-OSS
 */
define(['N/llm', 'N/runtime',
    './NAVA_ToolEngine',
    './NAVA_AuditLog'],
function (llm, runtime, toolEngine, auditLog) {

    var MAX_TOOL_ITERATIONS = 5;

    var SYSTEM_PROMPT =
        'You are NetSuite AI Voice Agent (NAVA), an enterprise assistant embedded inside NetSuite.\n' +
        'Your role is to help users interact with NetSuite using natural language.\n\n' +
        'RULES:\n' +
        '1. You have access to tools that can search records, get record details, count records, and check permissions.\n' +
        '2. Always use tools to ground your answers in real NetSuite data — never fabricate record IDs or data.\n' +
        '3. For write operations (create, edit, delete, approve), describe what you would do and ask for confirmation.\n' +
        '4. Always respect user permissions — check permissions before suggesting actions.\n' +
        '5. Keep responses concise and action-oriented.\n' +
        '6. When presenting records, include document numbers and amounts.\n' +
        '7. If a user asks about data you cannot access via tools, say so clearly.\n' +
        '8. Format currency values with dollar signs and commas.\n' +
        '9. Never expose internal IDs unless the user asks for them.\n' +
        '10. If unsure about a command, ask for clarification rather than guessing.';

    function processQuery(transcript, sessionId, conversationHistory) {
        var tools = toolEngine.getAllTools();
        var messages = buildMessages(transcript, conversationHistory);
        var iteration = 0;
        var finalResponse = null;

        while (iteration < MAX_TOOL_ITERATIONS) {
            iteration++;

            var governanceBefore = runtime.getCurrentScript().getRemainingUsage();

            var response = llm.generateText({
                prompt: messages[messages.length - 1].content,
                modelFamily: llm.ModelFamily.GPT_OSS,
                tools: tools
            });

            var governanceUsed = governanceBefore - runtime.getCurrentScript().getRemainingUsage();

            auditLog.logLLMCall(
                messages[messages.length - 1].content,
                response.text || '(tool_calls)',
                governanceUsed,
                sessionId
            );

            if (!response.toolCalls || response.toolCalls.length === 0) {
                finalResponse = response.text;
                break;
            }

            var toolResults = [];
            for (var i = 0; i < response.toolCalls.length; i++) {
                var toolCall = response.toolCalls[i];
                var result = toolEngine.executeToolCall(toolCall.name, toolCall.arguments);

                auditLog.logToolExecution(toolCall.name, toolCall.arguments, sessionId);
                toolResults.push(result);
            }

            var toolSummary = toolResults.map(function (r) {
                return 'Tool result: ' + (typeof r === 'string' ? r : JSON.stringify(r));
            }).join('\n');

            messages.push({
                role: 'assistant',
                content: response.text || ''
            });
            messages.push({
                role: 'user',
                content: 'Tool results:\n' + toolSummary + '\n\nBased on these results, provide your response to the user.'
            });
        }

        if (!finalResponse) {
            finalResponse = 'I was unable to complete the request within the processing limit. Please try a simpler query.';
        }

        return {
            response: finalResponse,
            iterationsUsed: iteration,
            sessionId: sessionId
        };
    }

    function processQueryStreamed(transcript, sessionId, onChunk) {
        var tools = toolEngine.getAllTools();

        var response = llm.generateTextStreamed({
            prompt: SYSTEM_PROMPT + '\n\nUser: ' + transcript,
            modelFamily: llm.ModelFamily.GPT_OSS,
            tools: tools
        });

        var fullText = '';
        var toolCalls = [];

        response.forEach(function (chunk) {
            if (chunk.text) {
                fullText += chunk.text;
                if (onChunk) onChunk(chunk.text);
            }
            if (chunk.toolCalls) {
                toolCalls = toolCalls.concat(chunk.toolCalls);
            }
        });

        if (toolCalls.length > 0) {
            var toolResults = toolCalls.map(function (tc) {
                return toolEngine.executeToolCall(tc.name, tc.arguments);
            });
            return processQuery(transcript + '\n\nPrevious tool results: ' + JSON.stringify(toolResults), sessionId, []);
        }

        return { response: fullText, iterationsUsed: 1, sessionId: sessionId };
    }

    function buildMessages(transcript, conversationHistory) {
        var messages = [{ role: 'system', content: SYSTEM_PROMPT }];

        if (conversationHistory && conversationHistory.length > 0) {
            var recentHistory = conversationHistory.slice(-6);
            recentHistory.forEach(function (msg) {
                messages.push(msg);
            });
        }

        messages.push({ role: 'user', content: transcript });
        return messages;
    }

    function generateSimpleResponse(prompt) {
        var response = llm.generateText({
            prompt: prompt,
            modelFamily: llm.ModelFamily.GPT_OSS
        });
        return response.text;
    }

    return {
        processQuery: processQuery,
        processQueryStreamed: processQueryStreamed,
        generateSimpleResponse: generateSimpleResponse,
        SYSTEM_PROMPT: SYSTEM_PROMPT,
        MAX_TOOL_ITERATIONS: MAX_TOOL_ITERATIONS
    };
});
