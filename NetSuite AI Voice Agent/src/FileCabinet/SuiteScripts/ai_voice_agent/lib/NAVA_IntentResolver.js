/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @description Intent resolution engine — classifies voice transcripts into structured NetSuite intents using N/llm
 */
define(['N/llm', 'N/log'], function (llm, log) {

    const CONFIDENCE_THRESHOLDS = {
        AUTO_EXECUTE: 0.85,
        CONFIRM: 0.60,
        REJECT: 0.60
    };

    const RECORD_TYPE_MAP = {
        'sales order': 'salesorder',
        'so': 'salesorder',
        'invoice': 'invoice',
        'inv': 'invoice',
        'purchase order': 'purchaseorder',
        'po': 'purchaseorder',
        'vendor bill': 'vendorbill',
        'bill': 'vendorbill',
        'customer': 'customer',
        'vendor': 'vendor',
        'employee': 'employee',
        'journal entry': 'journalentry',
        'je': 'journalentry',
        'credit memo': 'creditmemo',
        'cm': 'creditmemo',
        'estimate': 'estimate',
        'quote': 'estimate',
        'opportunity': 'opportunity',
        'item receipt': 'itemreceipt',
        'item fulfillment': 'itemfulfillment',
        'customer payment': 'customerpayment',
        'payment': 'customerpayment',
        'expense report': 'expensereport',
        'transfer order': 'transferorder',
        'work order': 'workorder',
        'inventory adjustment': 'inventoryadjustment',
        'return authorization': 'returnauthorization',
        'ra': 'returnauthorization',
        'case': 'supportcase',
        'support case': 'supportcase',
        'task': 'task',
        'phone call': 'phonecall',
        'contact': 'contact',
        'lead': 'lead',
        'prospect': 'prospect',
        'deposit': 'deposit',
        'bank deposit': 'deposit'
    };

    const ACTION_MAP = {
        'create': 'create',
        'make': 'create',
        'new': 'create',
        'add': 'create',
        'generate': 'create',
        'open': 'view',
        'view': 'view',
        'show': 'view',
        'look up': 'view',
        'lookup': 'view',
        'find': 'search',
        'search': 'search',
        'list': 'search',
        'get': 'search',
        'edit': 'edit',
        'update': 'edit',
        'modify': 'edit',
        'change': 'edit',
        'approve': 'approve',
        'reject': 'reject',
        'delete': 'delete',
        'remove': 'delete',
        'void': 'void',
        'close': 'close',
        'print': 'print',
        'email': 'email',
        'send': 'email'
    };

    const WRITE_ACTIONS = new Set(['create', 'edit', 'approve', 'reject', 'delete', 'void', 'close']);

    function resolveWithLLM(transcript) {
        var prompt = 'You are a NetSuite intent classifier. Given the user voice command below, extract a JSON object.\n\n' +
            'Rules:\n' +
            '- intent: one of create, view, search, edit, approve, reject, delete, void, close, print, email, navigate, unknown\n' +
            '- recordType: NetSuite internal ID (salesorder, invoice, customer, etc.) or empty string\n' +
            '- action: same as intent\n' +
            '- confidence: 0.0 to 1.0\n' +
            '- parameters: object with extracted entity names, document numbers, amounts, dates, item names, quantities\n' +
            '- parameters.entityName: customer/vendor name if mentioned\n' +
            '- parameters.documentNumber: tranid if mentioned (e.g., "SO-12345", "INV10021")\n' +
            '- parameters.items: array of {name, quantity, rate} if mentioned\n' +
            '- parameters.memo: any memo or note text\n\n' +
            'Respond with ONLY valid JSON, no markdown.\n\n' +
            'User command: "' + transcript + '"';

        var response = llm.generateText({
            prompt: prompt,
            modelFamily: llm.ModelFamily.GPT_OSS
        });

        try {
            var text = response.text.trim();
            if (text.startsWith('```')) {
                text = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
            }
            var parsed = JSON.parse(text);
            return {
                intent: parsed.intent || 'unknown',
                recordType: parsed.recordType || '',
                action: parsed.action || parsed.intent || 'unknown',
                confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
                parameters: parsed.parameters || {},
                requiresConfirmation: WRITE_ACTIONS.has(parsed.action || parsed.intent),
                source: 'llm'
            };
        } catch (e) {
            return null;
        }
    }

    function resolveWithRules(transcript) {
        var lower = transcript.toLowerCase().trim();
        var result = {
            intent: 'unknown',
            recordType: '',
            action: 'unknown',
            confidence: 0.0,
            parameters: {},
            requiresConfirmation: false,
            source: 'rules'
        };

        var actionKeys = Object.keys(ACTION_MAP);
        for (var i = 0; i < actionKeys.length; i++) {
            if (lower.indexOf(actionKeys[i]) === 0 || lower.indexOf(' ' + actionKeys[i] + ' ') > -1) {
                result.action = ACTION_MAP[actionKeys[i]];
                result.intent = result.action;
                result.confidence = 0.6;
                break;
            }
        }

        var recordKeys = Object.keys(RECORD_TYPE_MAP);
        for (var j = 0; j < recordKeys.length; j++) {
            if (lower.indexOf(recordKeys[j]) > -1) {
                result.recordType = RECORD_TYPE_MAP[recordKeys[j]];
                result.confidence = Math.min(result.confidence + 0.2, 0.95);
                break;
            }
        }

        var docNumMatch = lower.match(/(?:number|#|no\.?)\s*(\w+-?\d+|\d+)/);
        if (!docNumMatch) {
            docNumMatch = lower.match(/\b([A-Z]{2,}-?\d{3,}|\d{4,})\b/i);
        }
        if (docNumMatch) {
            result.parameters.documentNumber = docNumMatch[1];
            result.confidence = Math.min(result.confidence + 0.1, 0.95);
        }

        var forMatch = lower.match(/(?:for|from|to|by)\s+([a-z][a-z\s]{2,}?)(?:\s+(?:for|from|to|with|on|at|$))/i);
        if (forMatch) {
            result.parameters.entityName = forMatch[1].trim();
        }

        result.requiresConfirmation = WRITE_ACTIONS.has(result.action);

        return result;
    }

    function resolve(transcript) {
        if (!transcript || typeof transcript !== 'string' || transcript.trim().length === 0) {
            return {
                intent: 'unknown',
                recordType: '',
                action: 'unknown',
                confidence: 0.0,
                parameters: {},
                requiresConfirmation: false,
                source: 'empty',
                executionPolicy: 'reject'
            };
        }

        var llmResult = null;
        try {
            llmResult = resolveWithLLM(transcript);
        } catch (e) {
            log.audit('NAVA_IntentResolver', 'LLM fallback to rules: ' + e.message);
        }

        var rulesResult = resolveWithRules(transcript);

        var result = llmResult && llmResult.confidence > rulesResult.confidence ? llmResult : rulesResult;

        if (result.confidence >= CONFIDENCE_THRESHOLDS.AUTO_EXECUTE && !result.requiresConfirmation) {
            result.executionPolicy = 'auto';
        } else if (result.confidence >= CONFIDENCE_THRESHOLDS.CONFIRM || result.requiresConfirmation) {
            result.executionPolicy = 'confirm';
        } else {
            result.executionPolicy = 'reject';
        }

        return result;
    }

    function getRecordTypeMap() {
        return RECORD_TYPE_MAP;
    }

    function isWriteAction(action) {
        return WRITE_ACTIONS.has(action);
    }

    return {
        resolve: resolve,
        resolveWithLLM: resolveWithLLM,
        resolveWithRules: resolveWithRules,
        getRecordTypeMap: getRecordTypeMap,
        isWriteAction: isWriteAction,
        CONFIDENCE_THRESHOLDS: CONFIDENCE_THRESHOLDS
    };
});
