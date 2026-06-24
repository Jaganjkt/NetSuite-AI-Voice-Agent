/**
 * Unit tests for NAVA_IntentResolver
 */

jest.mock('N/llm', () => ({
    generateText: jest.fn(),
    ModelFamily: { GPT_OSS: 'GPT_OSS' }
}), { virtual: true });

jest.mock('N/log', () => ({
    audit: jest.fn(),
    debug: jest.fn(),
    error: jest.fn()
}), { virtual: true });

const llm = require('N/llm');

describe('NAVA_IntentResolver', () => {
    let intentResolver;

    beforeAll(() => {
        intentResolver = require('../src/FileCabinet/SuiteScripts/ai_voice_agent/lib/NAVA_IntentResolver');
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('resolveWithRules', () => {
        test('should detect "create sales order" intent', () => {
            const result = intentResolver.resolveWithRules('create sales order for ABC Corp');
            expect(result.action).toBe('create');
            expect(result.recordType).toBe('salesorder');
            expect(result.confidence).toBeGreaterThanOrEqual(0.6);
            expect(result.requiresConfirmation).toBe(true);
        });

        test('should detect "open invoice" intent', () => {
            const result = intentResolver.resolveWithRules('open invoice 10021');
            expect(result.action).toBe('view');
            expect(result.recordType).toBe('invoice');
            expect(result.parameters.documentNumber).toBeDefined();
        });

        test('should detect "search customer" intent', () => {
            const result = intentResolver.resolveWithRules('search customer ABC');
            expect(result.action).toBe('search');
            expect(result.recordType).toBe('customer');
        });

        test('should detect "approve purchase order" intent', () => {
            const result = intentResolver.resolveWithRules('approve purchase order PO-4421');
            expect(result.action).toBe('approve');
            expect(result.recordType).toBe('purchaseorder');
            expect(result.requiresConfirmation).toBe(true);
        });

        test('should return unknown for gibberish', () => {
            const result = intentResolver.resolveWithRules('asdfghjkl');
            expect(result.intent).toBe('unknown');
            expect(result.confidence).toBeLessThan(0.6);
        });

        test('should detect document numbers', () => {
            const result = intentResolver.resolveWithRules('open invoice number INV-12345');
            expect(result.parameters.documentNumber.toUpperCase()).toBe('INV-12345');
        });

        test('should detect abbreviations (SO, PO, JE)', () => {
            expect(intentResolver.resolveWithRules('create po').recordType).toBe('purchaseorder');
            expect(intentResolver.resolveWithRules('open je').recordType).toBe('journalentry');
        });
    });

    describe('resolve (full pipeline with LLM fallback)', () => {
        test('should use LLM result when confidence is higher', () => {
            llm.generateText.mockReturnValue({
                text: JSON.stringify({
                    intent: 'create',
                    recordType: 'salesorder',
                    action: 'create',
                    confidence: 0.95,
                    parameters: { entityName: 'ABC Corp' }
                })
            });

            const result = intentResolver.resolve('make a new SO for ABC Corp');
            expect(result.source).toBe('llm');
            expect(result.confidence).toBe(0.95);
            expect(result.recordType).toBe('salesorder');
        });

        test('should fall back to rules when LLM fails', () => {
            llm.generateText.mockImplementation(() => { throw new Error('LLM unavailable'); });

            const result = intentResolver.resolve('create sales order for ABC');
            expect(result.source).toBe('rules');
            expect(result.action).toBe('create');
            expect(result.recordType).toBe('salesorder');
        });

        test('should return reject policy for empty input', () => {
            const result = intentResolver.resolve('');
            expect(result.executionPolicy).toBe('reject');
        });

        test('should set confirm policy for write actions', () => {
            llm.generateText.mockReturnValue({
                text: JSON.stringify({
                    intent: 'create',
                    recordType: 'invoice',
                    action: 'create',
                    confidence: 0.90,
                    parameters: {}
                })
            });

            const result = intentResolver.resolve('create invoice');
            expect(result.executionPolicy).toBe('confirm');
        });

        test('should set auto policy for high-confidence read', () => {
            llm.generateText.mockReturnValue({
                text: JSON.stringify({
                    intent: 'view',
                    recordType: 'salesorder',
                    action: 'view',
                    confidence: 0.92,
                    parameters: { documentNumber: 'SO-100' }
                })
            });

            const result = intentResolver.resolve('show me sales order SO-100');
            expect(result.executionPolicy).toBe('auto');
        });
    });

    describe('isWriteAction', () => {
        test('should identify write actions', () => {
            expect(intentResolver.isWriteAction('create')).toBe(true);
            expect(intentResolver.isWriteAction('edit')).toBe(true);
            expect(intentResolver.isWriteAction('approve')).toBe(true);
            expect(intentResolver.isWriteAction('delete')).toBe(true);
            expect(intentResolver.isWriteAction('view')).toBe(false);
            expect(intentResolver.isWriteAction('search')).toBe(false);
        });
    });
});
