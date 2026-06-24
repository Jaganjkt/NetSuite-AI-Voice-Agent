/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 * @description Client Script for Voice Agent Suitelet — handles page initialization and keyboard shortcuts
 */
define(['N/currentRecord', 'N/log'], function (currentRecord, log) {

    function pageInit(context) {
        log.debug('NAVA_ClientScript', 'Voice Agent UI initialized');

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                var typing = document.getElementById('nava-typing');
                if (typing) typing.remove();
            }

            if ((e.ctrlKey || e.metaKey) && e.key === 'm') {
                e.preventDefault();
                var micBtn = document.getElementById('nava-mic-btn');
                if (micBtn) micBtn.click();
            }
        });
    }

    return {
        pageInit: pageInit
    };
});
