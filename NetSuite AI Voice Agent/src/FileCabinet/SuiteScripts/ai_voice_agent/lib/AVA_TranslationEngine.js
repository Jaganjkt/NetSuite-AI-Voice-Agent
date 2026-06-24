/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @description Multi-language translation engine using N/machineTranslation
 */
define(['N/machineTranslation', 'N/log'], function (mt, log) {

    var SUPPORTED_LANGUAGES = {
        'en': 'English',
        'es': 'Spanish',
        'fr': 'French',
        'de': 'German',
        'pt': 'Portuguese',
        'it': 'Italian',
        'nl': 'Dutch',
        'ja': 'Japanese',
        'zh': 'Chinese',
        'ko': 'Korean',
        'ar': 'Arabic',
        'hi': 'Hindi',
        'ta': 'Tamil',
        'te': 'Telugu',
        'et': 'Estonian',
        'fi': 'Finnish',
        'sv': 'Swedish',
        'da': 'Danish',
        'no': 'Norwegian',
        'pl': 'Polish',
        'ru': 'Russian',
        'uk': 'Ukrainian',
        'th': 'Thai',
        'vi': 'Vietnamese',
        'id': 'Indonesian',
        'ms': 'Malay',
        'tr': 'Turkish',
        'cs': 'Czech',
        'ro': 'Romanian',
        'hu': 'Hungarian',
        'el': 'Greek',
        'he': 'Hebrew'
    };

    function isLikelyEnglish(text) {
        var ascii = 0;
        var total = text.length;
        for (var i = 0; i < total; i++) {
            var code = text.charCodeAt(i);
            if (code < 128) ascii++;
        }
        return (ascii / total) > 0.9;
    }

    function translateToEnglish(text, sourceLanguage) {
        if (!text || text.trim().length === 0) {
            return { text: '', sourceLanguage: 'en', wasTranslated: false };
        }

        if (!sourceLanguage && isLikelyEnglish(text)) {
            return { text: text, sourceLanguage: 'en', wasTranslated: false };
        }

        if (sourceLanguage === 'en') {
            return { text: text, sourceLanguage: 'en', wasTranslated: false };
        }

        try {
            var options = {
                text: text,
                targetLanguage: 'en'
            };
            if (sourceLanguage) {
                options.sourceLanguage = sourceLanguage;
            }

            var translated = mt.translate(options);

            var srcLang = sourceLanguage || 'unknown';

            return {
                text: translated.text || text,
                sourceLanguage: srcLang,
                sourceLanguageName: SUPPORTED_LANGUAGES[srcLang] || srcLang,
                wasTranslated: true
            };
        } catch (e) {
            log.audit('AVA_Translation', 'Translation skipped: ' + e.message);
            return { text: text, sourceLanguage: 'en', wasTranslated: false };
        }
    }

    function translateFromEnglish(text, targetLanguage) {
        if (!text || !targetLanguage || targetLanguage === 'en') {
            return { text: text, wasTranslated: false };
        }

        try {
            var translated = mt.translate({
                text: text,
                sourceLanguage: 'en',
                targetLanguage: targetLanguage
            });

            return {
                text: translated.text || text,
                targetLanguage: targetLanguage,
                targetLanguageName: SUPPORTED_LANGUAGES[targetLanguage] || targetLanguage,
                wasTranslated: true
            };
        } catch (e) {
            log.audit('AVA_Translation', 'Translation failed: ' + e.message);
            return { text: text, wasTranslated: false };
        }
    }

    function getSupportedLanguages() {
        return SUPPORTED_LANGUAGES;
    }

    return {
        translateToEnglish: translateToEnglish,
        translateFromEnglish: translateFromEnglish,
        getSupportedLanguages: getSupportedLanguages
    };
});
