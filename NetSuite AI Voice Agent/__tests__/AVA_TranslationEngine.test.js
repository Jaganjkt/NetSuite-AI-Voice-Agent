/**
 * Unit tests for AVA_TranslationEngine
 */

jest.mock('N/machineTranslation', () => ({
    translate: jest.fn()
}), { virtual: true });

jest.mock('N/log', () => ({
    audit: jest.fn(),
    debug: jest.fn(),
    error: jest.fn()
}), { virtual: true });

const mt = require('N/machineTranslation');

describe('AVA_TranslationEngine', () => {
    let translationEngine;

    beforeAll(() => {
        translationEngine = require('../src/FileCabinet/SuiteScripts/ai_voice_agent/lib/AVA_TranslationEngine');
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('translateToEnglish', () => {
        test('should pass through English text without calling translate', () => {
            const result = translationEngine.translateToEnglish('hello world');
            expect(result.wasTranslated).toBe(false);
            expect(result.text).toBe('hello world');
            expect(mt.translate).not.toHaveBeenCalled();
        });

        test('should pass through when sourceLanguage is en', () => {
            const result = translationEngine.translateToEnglish('hello', 'en');
            expect(result.wasTranslated).toBe(false);
            expect(mt.translate).not.toHaveBeenCalled();
        });

        test('should translate when sourceLanguage is provided', () => {
            mt.translate.mockReturnValue({ text: 'create purchase order' });
            const result = translationEngine.translateToEnglish('purchase order banao', 'hi');
            expect(result.wasTranslated).toBe(true);
            expect(result.text).toBe('create purchase order');
            expect(result.sourceLanguageName).toBe('Hindi');
        });

        test('should handle empty text', () => {
            const result = translationEngine.translateToEnglish('');
            expect(result.wasTranslated).toBe(false);
            expect(result.text).toBe('');
        });

        test('should fallback gracefully if translate throws', () => {
            mt.translate.mockImplementation(() => { throw new Error('service unavailable'); });
            const result = translationEngine.translateToEnglish('some text', 'fr');
            expect(result.wasTranslated).toBe(false);
            expect(result.text).toBe('some text');
        });
    });

    describe('translateFromEnglish', () => {
        test('should translate to target language', () => {
            mt.translate.mockReturnValue({ text: 'facture creee' });
            const result = translationEngine.translateFromEnglish('invoice created', 'fr');
            expect(result.wasTranslated).toBe(true);
            expect(result.targetLanguageName).toBe('French');
        });

        test('should pass through when target is English', () => {
            const result = translationEngine.translateFromEnglish('hello', 'en');
            expect(result.wasTranslated).toBe(false);
        });

        test('should fallback if translate throws', () => {
            mt.translate.mockImplementation(() => { throw new Error('fail'); });
            const result = translationEngine.translateFromEnglish('hello', 'de');
            expect(result.wasTranslated).toBe(false);
            expect(result.text).toBe('hello');
        });
    });

    describe('getSupportedLanguages', () => {
        test('should return language map', () => {
            const langs = translationEngine.getSupportedLanguages();
            expect(langs.en).toBe('English');
            expect(langs.ta).toBe('Tamil');
            expect(langs.hi).toBe('Hindi');
            expect(langs.et).toBe('Estonian');
            expect(Object.keys(langs).length).toBeGreaterThan(20);
        });
    });
});
