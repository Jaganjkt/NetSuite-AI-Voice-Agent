/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 * @description RESTlet endpoint for Voice Agent — enables mobile app and external integrations
 */
define(['N/log', 'N/runtime',
    './lib/NAVA_IntentResolver',
    './lib/NAVA_TranslationEngine',
    './lib/NAVA_LLMOrchestrator',
    './lib/NAVA_ActionRouter',
    './lib/NAVA_AuditLog'],
function (log, runtime,
    intentResolver, translationEngine, llmOrchestrator, actionRouter, auditLog) {

    function post(requestBody) {
        var action = requestBody.action;
        var transcript = requestBody.transcript;
        var sessionId = requestBody.sessionId || 'rest_' + Date.now();
        var sourceLanguage = requestBody.sourceLanguage;

        try {
            if (action === 'process') {
                return processVoiceCommand(transcript, sessionId, sourceLanguage);
            }

            if (action === 'confirm') {
                auditLog.logUserConfirmation(requestBody.intent, true, sessionId);
                var result = actionRouter.executeIntent(requestBody.intent);
                auditLog.logActionResult(requestBody.intent, result, sessionId);
                return { success: true, data: result };
            }

            if (action === 'reject') {
                auditLog.logUserConfirmation(requestBody.intent, false, sessionId);
                return { success: true, message: 'Action cancelled.' };
            }

            if (action === 'languages') {
                return { success: true, languages: translationEngine.getSupportedLanguages() };
            }

            return { success: false, message: 'Unknown action: ' + action };
        } catch (e) {
            log.error('NAVA_RESTlet', e.message);
            auditLog.logError({ action: action }, e.message, sessionId);
            return { success: false, error: e.message };
        }
    }

    function processVoiceCommand(transcript, sessionId, sourceLanguage) {
        auditLog.logVoiceInput(transcript, sessionId);

        var translation = translationEngine.translateToEnglish(transcript, sourceLanguage);
        var englishText = translation.text;

        var intent = intentResolver.resolve(englishText);
        auditLog.logIntentResolution(englishText, intent, sessionId);

        if (intent.executionPolicy === 'reject') {
            var clarification = llmOrchestrator.generateSimpleResponse(
                'User said: "' + englishText + '". Could not determine intent. Ask for clarification concisely.'
            );
            return {
                success: true,
                type: 'clarification',
                message: clarification,
                intent: intent
            };
        }

        if (intent.executionPolicy === 'confirm') {
            return {
                success: true,
                type: 'confirmation_required',
                message: 'I want to ' + intent.action + ' a ' + intent.recordType + '. Proceed?',
                intent: intent
            };
        }

        if (intent.action === 'search' || intent.action === 'view') {
            var llmResult = llmOrchestrator.processQuery(englishText, sessionId, []);
            return { success: true, type: 'result', message: llmResult.response, intent: intent };
        }

        var execResult = actionRouter.executeIntent(intent);
        auditLog.logActionResult(intent, execResult, sessionId);
        return { success: true, type: 'result', data: execResult, intent: intent };
    }

    function get(requestParams) {
        return {
            agent: 'NetSuite AI Voice Agent',
            version: '1.0.0',
            status: 'active',
            governance: {
                remaining: runtime.getCurrentScript().getRemainingUsage()
            }
        };
    }

    return {
        post: post,
        get: get
    };
});
