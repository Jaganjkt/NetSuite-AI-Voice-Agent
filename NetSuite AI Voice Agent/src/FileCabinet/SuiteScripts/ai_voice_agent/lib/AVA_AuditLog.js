/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @description Audit logging service — records all AI decisions, tool executions, and user confirmations
 */
define(['N/record', 'N/runtime', 'N/format'], function (record, runtime, format) {

    var CUSTOM_RECORD_TYPE = 'customrecord_ava_audit_log';

    var EVENT_TYPES = {
        VOICE_INPUT: 'voice_input',
        TRANSLATION: 'translation',
        INTENT_RESOLVED: 'intent_resolved',
        TOOL_EXECUTED: 'tool_executed',
        LLM_CALL: 'llm_call',
        USER_CONFIRMED: 'user_confirmed',
        USER_REJECTED: 'user_rejected',
        ACTION_EXECUTED: 'action_executed',
        ACTION_FAILED: 'action_failed',
        PERMISSION_DENIED: 'permission_denied',
        ERROR: 'error'
    };

    function createEntry(options) {
        var user = runtime.getCurrentUser();

        var logRecord = record.create({ type: CUSTOM_RECORD_TYPE });

        logRecord.setValue({ fieldId: 'custrecord_ava_event_type', value: options.eventType });
        logRecord.setValue({ fieldId: 'custrecord_ava_user_id', value: String(user.id) });
        logRecord.setValue({ fieldId: 'custrecord_ava_user_name', value: user.name });
        logRecord.setValue({ fieldId: 'custrecord_ava_role_id', value: String(user.role) });
        logRecord.setValue({ fieldId: 'custrecord_ava_timestamp', value: new Date() });

        if (options.transcript) {
            logRecord.setValue({ fieldId: 'custrecord_ava_transcript', value: options.transcript.substring(0, 4000) });
        }
        if (options.intentJson) {
            logRecord.setValue({ fieldId: 'custrecord_ava_intent_json', value: JSON.stringify(options.intentJson).substring(0, 4000) });
        }
        if (options.actionResult) {
            logRecord.setValue({ fieldId: 'custrecord_ava_action_result', value: JSON.stringify(options.actionResult).substring(0, 4000) });
        }
        if (options.errorMessage) {
            logRecord.setValue({ fieldId: 'custrecord_ava_error_msg', value: options.errorMessage.substring(0, 4000) });
        }
        if (options.governanceUsed) {
            logRecord.setValue({ fieldId: 'custrecord_ava_governance', value: options.governanceUsed });
        }
        if (options.sourceLanguage) {
            logRecord.setValue({ fieldId: 'custrecord_ava_source_lang', value: options.sourceLanguage });
        }
        if (options.confidence) {
            logRecord.setValue({ fieldId: 'custrecord_ava_confidence', value: options.confidence });
        }
        if (options.sessionId) {
            logRecord.setValue({ fieldId: 'custrecord_ava_session_id', value: options.sessionId });
        }

        return logRecord.save();
    }

    function logVoiceInput(transcript, sessionId) {
        return createEntry({
            eventType: EVENT_TYPES.VOICE_INPUT,
            transcript: transcript,
            sessionId: sessionId
        });
    }

    function logIntentResolution(transcript, intent, sessionId) {
        return createEntry({
            eventType: EVENT_TYPES.INTENT_RESOLVED,
            transcript: transcript,
            intentJson: intent,
            confidence: intent.confidence,
            sessionId: sessionId
        });
    }

    function logToolExecution(toolName, toolResult, sessionId) {
        return createEntry({
            eventType: EVENT_TYPES.TOOL_EXECUTED,
            intentJson: { tool: toolName },
            actionResult: toolResult,
            sessionId: sessionId
        });
    }

    function logLLMCall(prompt, response, governanceUsed, sessionId) {
        return createEntry({
            eventType: EVENT_TYPES.LLM_CALL,
            transcript: prompt.substring(0, 4000),
            actionResult: { response: response.substring(0, 2000) },
            governanceUsed: governanceUsed,
            sessionId: sessionId
        });
    }

    function logUserConfirmation(intent, confirmed, sessionId) {
        return createEntry({
            eventType: confirmed ? EVENT_TYPES.USER_CONFIRMED : EVENT_TYPES.USER_REJECTED,
            intentJson: intent,
            sessionId: sessionId
        });
    }

    function logActionResult(intent, result, sessionId) {
        return createEntry({
            eventType: EVENT_TYPES.ACTION_EXECUTED,
            intentJson: intent,
            actionResult: result,
            sessionId: sessionId
        });
    }

    function logError(context, errorMessage, sessionId) {
        return createEntry({
            eventType: EVENT_TYPES.ERROR,
            intentJson: context,
            errorMessage: errorMessage,
            sessionId: sessionId
        });
    }

    function logPermissionDenied(intent, details, sessionId) {
        return createEntry({
            eventType: EVENT_TYPES.PERMISSION_DENIED,
            intentJson: intent,
            errorMessage: details,
            sessionId: sessionId
        });
    }

    return {
        createEntry: createEntry,
        logVoiceInput: logVoiceInput,
        logIntentResolution: logIntentResolution,
        logToolExecution: logToolExecution,
        logLLMCall: logLLMCall,
        logUserConfirmation: logUserConfirmation,
        logActionResult: logActionResult,
        logError: logError,
        logPermissionDenied: logPermissionDenied,
        EVENT_TYPES: EVENT_TYPES
    };
});
