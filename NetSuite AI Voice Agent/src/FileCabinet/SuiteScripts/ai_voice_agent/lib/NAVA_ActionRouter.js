/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @description NetSuite Action Router — executes resolved intents against real NetSuite records
 */
define(['N/record', 'N/search', 'N/url', 'N/runtime', 'N/log'],
function (record, search, url, runtime, log) {

    var ENTITY_RECORD_TYPES = {
        'customer': true, 'vendor': true, 'employee': true,
        'contact': true, 'lead': true, 'prospect': true, 'partner': true
    };

    var TRANSACTION_RECORD_TYPES = {
        'salesorder': true, 'invoice': true, 'purchaseorder': true, 'vendorbill': true,
        'journalentry': true, 'creditmemo': true, 'estimate': true, 'opportunity': true,
        'itemreceipt': true, 'itemfulfillment': true, 'customerpayment': true,
        'expensereport': true, 'transferorder': true, 'workorder': true,
        'inventoryadjustment': true, 'returnauthorization': true, 'deposit': true,
        'vendorpayment': true, 'check': true, 'cashsale': true, 'cashrefund': true
    };

    function executeIntent(intent) {
        var action = intent.action;
        var recordType = intent.recordType;
        var params = intent.parameters || {};

        if (!recordType) {
            return { success: false, message: 'I could not determine the record type. Please specify (e.g., sales order, invoice, customer).' };
        }

        try {
            switch (action) {
                case 'view':   return executeView(recordType, params);
                case 'search': return executeSearch(recordType, params);
                case 'create': return executeCreate(recordType, params);
                case 'edit':   return executeEdit(recordType, params);
                case 'approve': return executeApprove(recordType, params);
                case 'delete': return executeDelete(recordType, params);
                default:       return executeSearch(recordType, params);
            }
        } catch (e) {
            log.error('NAVA_ActionRouter', action + ' on ' + recordType + ': ' + e.message);
            return { success: false, message: 'Error executing ' + action + ' on ' + recordType + ': ' + e.message };
        }
    }

    function executeView(recordType, params) {
        var internalId = resolveRecordId(recordType, params);

        if (!internalId) {
            return executeSearch(recordType, params);
        }

        var recordUrl = resolveUrl(recordType, internalId, false);
        var summary = loadRecordSummary(recordType, internalId);

        var msg = formatRecordType(recordType) + ' ' + (summary.tranid || summary.entityid || '#' + internalId);
        if (summary.entity) msg += ' — ' + summary.entity;
        if (summary.total) msg += ' — Amount: $' + summary.total;
        if (summary.status) msg += ' — Status: ' + summary.status;

        return {
            success: true,
            action: 'view',
            recordType: recordType,
            internalId: internalId,
            recordUrl: recordUrl,
            message: msg,
            record: summary
        };
    }

    function executeSearch(recordType, params) {
        var filters = [];
        var columns = [];
        var isEntity = !!ENTITY_RECORD_TYPES[recordType];
        var isTxn = !!TRANSACTION_RECORD_TYPES[recordType];

        if (isEntity) {
            columns = [
                search.createColumn({ name: 'entityid' }),
                search.createColumn({ name: 'email' })
            ];
            if (params.entityName) {
                filters.push(search.createFilter({
                    name: 'entityid', operator: search.Operator.CONTAINS, values: [params.entityName]
                }));
            }
        } else if (isTxn) {
            columns = [
                search.createColumn({ name: 'tranid' }),
                search.createColumn({ name: 'trandate', sort: search.Sort.DESC }),
                search.createColumn({ name: 'entity' }),
                search.createColumn({ name: 'amount' }),
                search.createColumn({ name: 'statusref' })
            ];
            if (params.entityName) {
                var entityIds = findEntityIds(params.entityName);
                if (entityIds.length > 0) {
                    filters.push(search.createFilter({
                        name: 'entity', operator: search.Operator.ANYOF, values: entityIds
                    }));
                }
            }
            if (params.documentNumber) {
                filters.push(search.createFilter({
                    name: 'tranid', operator: search.Operator.CONTAINS, values: [params.documentNumber]
                }));
            }
        } else {
            columns = [
                search.createColumn({ name: 'name' })
            ];
        }

        if (params.mainline !== false && isTxn) {
            filters.push(search.createFilter({ name: 'mainline', operator: search.Operator.IS, values: ['T'] }));
        }

        var searchObj = search.create({ type: recordType, filters: filters, columns: columns });
        var results = [];
        var maxResults = 20;

        searchObj.run().each(function (r) {
            var row = {};
            columns.forEach(function (col) {
                row[col.name] = r.getText(col) || r.getValue(col);
            });
            row.internalId = r.id;
            row.recordUrl = resolveUrl(recordType, r.id, false);
            results.push(row);
            return results.length < maxResults;
        });

        if (results.length === 0) {
            return {
                success: true,
                action: 'search',
                recordType: recordType,
                message: 'No ' + formatRecordType(recordType) + ' records found matching your criteria.',
                results: []
            };
        }

        if (results.length === 1) {
            return {
                success: true,
                action: 'view',
                recordType: recordType,
                internalId: results[0].internalId,
                recordUrl: results[0].recordUrl,
                message: 'Found 1 ' + formatRecordType(recordType) + '. Opening it now.',
                results: results
            };
        }

        return {
            success: true,
            action: 'search',
            recordType: recordType,
            message: 'Found ' + results.length + ' ' + formatRecordType(recordType) + ' records:',
            results: results
        };
    }

    function executeCreate(recordType, params) {
        var rec = record.create({ type: recordType, isDynamic: true });

        if (params.entityName) {
            var entityIds = findEntityIds(params.entityName);
            if (entityIds.length > 0) {
                try { rec.setValue({ fieldId: 'entity', value: entityIds[0] }); } catch (e) { }
            }
        }

        if (params.memo) {
            try { rec.setValue({ fieldId: 'memo', value: params.memo }); } catch (e) { }
        }

        if (params.items && params.items.length > 0) {
            params.items.forEach(function (item) {
                var itemId = findItemId(item.name);
                if (itemId) {
                    rec.selectNewLine({ sublistId: 'item' });
                    rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: itemId });
                    if (item.quantity) rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: item.quantity });
                    if (item.rate) rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: item.rate });
                    rec.commitLine({ sublistId: 'item' });
                }
            });
        }

        var savedId = rec.save();
        var recordUrl = resolveUrl(recordType, savedId, false);

        return {
            success: true,
            action: 'create',
            recordType: recordType,
            internalId: savedId,
            recordUrl: recordUrl,
            message: formatRecordType(recordType) + ' created successfully (ID: ' + savedId + '). Opening record.'
        };
    }

    function executeEdit(recordType, params) {
        var internalId = resolveRecordId(recordType, params);
        if (!internalId) {
            return { success: false, message: 'Could not find ' + formatRecordType(recordType) + ' to edit.' };
        }

        var recordUrl = resolveUrl(recordType, internalId, true);

        return {
            success: true,
            action: 'edit',
            recordType: recordType,
            internalId: internalId,
            recordUrl: recordUrl,
            message: 'Opening ' + formatRecordType(recordType) + ' #' + internalId + ' in edit mode.'
        };
    }

    function executeApprove(recordType, params) {
        var internalId = resolveRecordId(recordType, params);
        if (!internalId) {
            return { success: false, message: 'Could not find ' + formatRecordType(recordType) + ' to approve.' };
        }

        record.submitFields({
            type: recordType,
            id: internalId,
            values: { approvalstatus: 2 }
        });

        var recordUrl = resolveUrl(recordType, internalId, false);

        return {
            success: true,
            action: 'approve',
            recordType: recordType,
            internalId: internalId,
            recordUrl: recordUrl,
            message: formatRecordType(recordType) + ' #' + internalId + ' has been approved. Opening record.'
        };
    }

    function executeDelete(recordType, params) {
        var internalId = resolveRecordId(recordType, params);
        if (!internalId) {
            return { success: false, message: 'Could not find ' + formatRecordType(recordType) + ' to delete.' };
        }

        record.delete({ type: recordType, id: internalId });

        return {
            success: true,
            action: 'delete',
            recordType: recordType,
            internalId: internalId,
            message: formatRecordType(recordType) + ' #' + internalId + ' has been deleted.'
        };
    }

    function resolveRecordId(recordType, params) {
        if (params.internalId) return params.internalId;

        if (params.documentNumber) {
            var docNum = params.documentNumber;
            var isEntity = !!ENTITY_RECORD_TYPES[recordType];
            var searchField = isEntity ? 'entityid' : 'tranid';

            var filters = [
                search.createFilter({ name: searchField, operator: search.Operator.IS, values: [docNum] })
            ];
            if (!isEntity) {
                filters.push(search.createFilter({ name: 'mainline', operator: search.Operator.IS, values: ['T'] }));
            }

            var lookupSearch = search.create({
                type: recordType,
                filters: filters,
                columns: ['internalid']
            });
            var results = lookupSearch.run().getRange({ start: 0, end: 1 });
            if (results.length > 0) return results[0].id;

            var containsSearch = search.create({
                type: recordType,
                filters: [
                    search.createFilter({ name: searchField, operator: search.Operator.CONTAINS, values: [docNum] })
                ],
                columns: ['internalid']
            });
            var containsResults = containsSearch.run().getRange({ start: 0, end: 1 });
            if (containsResults.length > 0) return containsResults[0].id;
        }

        if (params.entityName) {
            if (ENTITY_RECORD_TYPES[recordType]) {
                var ids = findEntityIds(params.entityName);
                if (ids.length > 0) return ids[0];
            } else {
                var entityIds = findEntityIds(params.entityName);
                if (entityIds.length > 0) {
                    var txnSearch = search.create({
                        type: recordType,
                        filters: [
                            search.createFilter({ name: 'entity', operator: search.Operator.ANYOF, values: entityIds }),
                            search.createFilter({ name: 'mainline', operator: search.Operator.IS, values: ['T'] })
                        ],
                        columns: [search.createColumn({ name: 'trandate', sort: search.Sort.DESC })]
                    });
                    var txnResults = txnSearch.run().getRange({ start: 0, end: 1 });
                    if (txnResults.length > 0) return txnResults[0].id;
                }
            }
        }

        return null;
    }

    function resolveUrl(recordType, recordId, isEditMode) {
        try {
            return url.resolveRecord({
                recordType: recordType,
                recordId: recordId,
                isEditMode: !!isEditMode
            });
        } catch (e) {
            return '/app/common/entity/entity.nl?id=' + recordId;
        }
    }

    function loadRecordSummary(recordType, internalId) {
        var summary = {};
        var fields = ['tranid', 'trandate', 'total', 'amount', 'memo',
            'companyname', 'entityid', 'email', 'phone'];

        var lookupFields = [];
        fields.forEach(function (f) { lookupFields.push(f); });

        try {
            var values = search.lookupFields({
                type: recordType,
                id: internalId,
                columns: lookupFields
            });
            for (var key in values) {
                if (values[key] && values[key].length !== 0) {
                    if (Array.isArray(values[key]) && values[key].length > 0 && values[key][0].text) {
                        summary[key] = values[key][0].text;
                    } else {
                        summary[key] = values[key];
                    }
                }
            }
        } catch (e) {
            log.debug('NAVA_ActionRouter', 'Lookup failed for ' + recordType + ' ' + internalId + ': ' + e.message);
        }

        try {
            var statusSearch = search.create({
                type: recordType,
                filters: [search.createFilter({ name: 'internalid', operator: search.Operator.IS, values: [internalId] })],
                columns: [
                    search.createColumn({ name: 'statusref' }),
                    search.createColumn({ name: 'entity' })
                ]
            });
            var statusResults = statusSearch.run().getRange({ start: 0, end: 1 });
            if (statusResults.length > 0) {
                summary.status = statusResults[0].getText({ name: 'statusref' }) || statusResults[0].getValue({ name: 'statusref' });
                summary.entity = statusResults[0].getText({ name: 'entity' }) || statusResults[0].getValue({ name: 'entity' });
            }
        } catch (e) { }

        return summary;
    }

    function findEntityIds(nameQuery) {
        var ids = [];
        var types = ['customer', 'vendor'];

        for (var t = 0; t < types.length; t++) {
            try {
                var entitySearch = search.create({
                    type: types[t],
                    filters: [
                        search.createFilter({ name: 'entityid', operator: search.Operator.CONTAINS, values: [nameQuery] })
                    ],
                    columns: ['internalid']
                });
                entitySearch.run().each(function (r) {
                    ids.push(r.id);
                    return ids.length < 5;
                });
                if (ids.length > 0) break;
            } catch (e) { }
        }
        return ids;
    }

    function findItemId(itemName) {
        try {
            var itemSearch = search.create({
                type: search.Type.ITEM,
                filters: [
                    search.createFilter({ name: 'displayname', operator: search.Operator.CONTAINS, values: [itemName] })
                ],
                columns: ['internalid']
            });
            var results = itemSearch.run().getRange({ start: 0, end: 1 });
            return results.length > 0 ? results[0].id : null;
        } catch (e) { return null; }
    }

    function formatRecordType(recordType) {
        return recordType.replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/([a-z])([a-z])/g, function (m) { return m; })
            .replace(/^./, function (c) { return c.toUpperCase(); })
            .replace('salesorder', 'Sales Order')
            .replace('purchaseorder', 'Purchase Order')
            .replace('vendorbill', 'Vendor Bill')
            .replace('journalentry', 'Journal Entry')
            .replace('creditmemo', 'Credit Memo')
            .replace('customerpayment', 'Customer Payment')
            .replace('itemreceipt', 'Item Receipt')
            .replace('itemfulfillment', 'Item Fulfillment')
            .replace('expensereport', 'Expense Report')
            .replace('transferorder', 'Transfer Order')
            .replace('workorder', 'Work Order')
            .replace('returnauthorization', 'Return Authorization')
            .replace('inventoryadjustment', 'Inventory Adjustment');
    }

    return {
        executeIntent: executeIntent,
        resolveRecordId: resolveRecordId,
        findEntityIds: findEntityIds,
        findItemId: findItemId
    };
});
