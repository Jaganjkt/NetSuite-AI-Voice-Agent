/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @description LLM Tool Execution Engine — defines N/llm tools for dynamic NetSuite operations within AI flow
 */
define(['N/llm', 'N/search', 'N/record', 'N/runtime', 'N/url'],
function (llm, search, record, runtime, url) {

    function createSearchRecordsTool() {
        return llm.createTool({
            name: 'search_records',
            description: 'Search NetSuite records by type and criteria. Use for finding transactions, entities, items.',
            parameters: [
                llm.createToolParameter({
                    name: 'record_type',
                    type: 'string',
                    description: 'NetSuite record type internal ID (e.g., salesorder, invoice, customer, vendor, item)',
                    required: true
                }),
                llm.createToolParameter({
                    name: 'search_text',
                    type: 'string',
                    description: 'Text to search for in record name, entity ID, or document number',
                    required: false
                }),
                llm.createToolParameter({
                    name: 'date_from',
                    type: 'string',
                    description: 'Start date filter in MM/DD/YYYY format',
                    required: false
                }),
                llm.createToolParameter({
                    name: 'date_to',
                    type: 'string',
                    description: 'End date filter in MM/DD/YYYY format',
                    required: false
                }),
                llm.createToolParameter({
                    name: 'max_results',
                    type: 'number',
                    description: 'Maximum results to return (default 10, max 50)',
                    required: false
                })
            ]
        });
    }

    function createGetRecordTool() {
        return llm.createTool({
            name: 'get_record',
            description: 'Load and return details of a specific NetSuite record by internal ID.',
            parameters: [
                llm.createToolParameter({
                    name: 'record_type',
                    type: 'string',
                    description: 'NetSuite record type internal ID',
                    required: true
                }),
                llm.createToolParameter({
                    name: 'record_id',
                    type: 'number',
                    description: 'Internal ID of the record',
                    required: true
                })
            ]
        });
    }

    function createGetRecordCountTool() {
        return llm.createTool({
            name: 'get_record_count',
            description: 'Count records matching criteria. Use for questions like "how many open invoices?"',
            parameters: [
                llm.createToolParameter({
                    name: 'record_type',
                    type: 'string',
                    description: 'NetSuite record type internal ID',
                    required: true
                }),
                llm.createToolParameter({
                    name: 'status',
                    type: 'string',
                    description: 'Status filter (e.g., open, closed, pending)',
                    required: false
                }),
                llm.createToolParameter({
                    name: 'date_from',
                    type: 'string',
                    description: 'Start date in MM/DD/YYYY format',
                    required: false
                })
            ]
        });
    }

    function createCheckPermissionTool() {
        return llm.createTool({
            name: 'check_permission',
            description: 'Check if the current user has permission to perform an action on a record type.',
            parameters: [
                llm.createToolParameter({
                    name: 'record_type',
                    type: 'string',
                    description: 'NetSuite record type',
                    required: true
                }),
                llm.createToolParameter({
                    name: 'action',
                    type: 'string',
                    description: 'Action to check: create, edit, view, delete',
                    required: true
                })
            ]
        });
    }

    function createGetUserContextTool() {
        return llm.createTool({
            name: 'get_user_context',
            description: 'Get current user details: name, role, subsidiary, permissions context.',
            parameters: []
        });
    }

    function executeToolCall(toolName, toolArgs) {
        switch (toolName) {
            case 'search_records':
                return executeSearchRecords(toolArgs);
            case 'get_record':
                return executeGetRecord(toolArgs);
            case 'get_record_count':
                return executeGetRecordCount(toolArgs);
            case 'check_permission':
                return executeCheckPermission(toolArgs);
            case 'get_user_context':
                return executeGetUserContext();
            default:
                return llm.createToolResult({
                    toolName: toolName,
                    output: JSON.stringify({ error: 'Unknown tool: ' + toolName })
                });
        }
    }

    function executeSearchRecords(args) {
        var recordType = args.record_type;
        var searchText = args.search_text || '';
        var maxResults = Math.min(args.max_results || 10, 50);

        var filters = [];
        var columns = [];

        var isTransaction = ['salesorder', 'invoice', 'purchaseorder', 'vendorbill',
            'journalentry', 'creditmemo', 'estimate', 'customerpayment', 'expensereport'].indexOf(recordType) > -1;

        if (isTransaction) {
            columns = [
                search.createColumn({ name: 'tranid' }),
                search.createColumn({ name: 'trandate', sort: search.Sort.DESC }),
                search.createColumn({ name: 'entity' }),
                search.createColumn({ name: 'amount' }),
                search.createColumn({ name: 'statusref' })
            ];
            if (searchText) {
                filters.push(search.createFilter({ name: 'formulatext', formula: "{tranid} || ' ' || {entity}", operator: search.Operator.CONTAINS, values: [searchText] }));
            }
            if (args.date_from) {
                filters.push(search.createFilter({ name: 'trandate', operator: search.Operator.ONORAFTER, values: [args.date_from] }));
            }
            if (args.date_to) {
                filters.push(search.createFilter({ name: 'trandate', operator: search.Operator.ONORBEFORE, values: [args.date_to] }));
            }
        } else {
            columns = [
                search.createColumn({ name: 'entityid' }),
                search.createColumn({ name: 'email' })
            ];
            if (searchText) {
                filters.push(search.createFilter({ name: 'entityid', operator: search.Operator.CONTAINS, values: [searchText] }));
            }
        }

        var searchObj = search.create({ type: recordType, filters: filters, columns: columns });
        var results = [];
        searchObj.run().each(function (r) {
            var row = { id: r.id };
            columns.forEach(function (col) {
                row[col.name] = r.getText(col) || r.getValue(col);
            });
            results.push(row);
            return results.length < maxResults;
        });

        return llm.createToolResult({
            toolName: 'search_records',
            output: JSON.stringify({ count: results.length, results: results })
        });
    }

    function executeGetRecord(args) {
        try {
            var rec = record.load({ type: args.record_type, id: args.record_id });
            var fields = ['tranid', 'trandate', 'entity', 'total', 'amount', 'status', 'memo',
                'companyname', 'entityid', 'email', 'phone', 'subsidiary', 'department', 'location'];

            var data = { id: args.record_id, type: args.record_type };
            fields.forEach(function (f) {
                try {
                    var val = rec.getText({ fieldId: f }) || rec.getValue({ fieldId: f });
                    if (val) data[f] = val;
                } catch (e) { }
            });

            return llm.createToolResult({ toolName: 'get_record', output: JSON.stringify(data) });
        } catch (e) {
            return llm.createToolResult({ toolName: 'get_record', output: JSON.stringify({ error: e.message }) });
        }
    }

    function executeGetRecordCount(args) {
        var filters = [];
        if (args.status) {
            filters.push(search.createFilter({ name: 'statusref', operator: search.Operator.IS, values: [args.status] }));
        }
        if (args.date_from) {
            filters.push(search.createFilter({ name: 'trandate', operator: search.Operator.ONORAFTER, values: [args.date_from] }));
        }

        var searchObj = search.create({
            type: args.record_type,
            filters: filters,
            columns: [search.createColumn({ name: 'internalid', summary: search.Summary.COUNT })]
        });

        var results = searchObj.run().getRange({ start: 0, end: 1 });
        var count = results.length > 0 ? results[0].getValue({ name: 'internalid', summary: search.Summary.COUNT }) : 0;

        return llm.createToolResult({ toolName: 'get_record_count', output: JSON.stringify({ count: count }) });
    }

    function executeCheckPermission(args) {
        var permMap = { 'create': 1, 'view': 1, 'edit': 2, 'delete': 4 };
        var level = permMap[args.action] || 1;

        try {
            var perm = runtime.getCurrentUser().getPermission({ name: 'LIST_' + args.record_type.toUpperCase() });
            var hasPermission = perm >= level;
            return llm.createToolResult({
                toolName: 'check_permission',
                output: JSON.stringify({ hasPermission: hasPermission, level: perm, required: level })
            });
        } catch (e) {
            return llm.createToolResult({
                toolName: 'check_permission',
                output: JSON.stringify({ hasPermission: true, note: 'Permission check unavailable, assuming allowed.' })
            });
        }
    }

    function executeGetUserContext() {
        var user = runtime.getCurrentUser();
        return llm.createToolResult({
            toolName: 'get_user_context',
            output: JSON.stringify({
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                roleId: user.roleId,
                subsidiary: user.subsidiary,
                department: user.department,
                location: user.location
            })
        });
    }

    function getAllTools() {
        return [
            createSearchRecordsTool(),
            createGetRecordTool(),
            createGetRecordCountTool(),
            createCheckPermissionTool(),
            createGetUserContextTool()
        ];
    }

    return {
        getAllTools: getAllTools,
        executeToolCall: executeToolCall,
        createSearchRecordsTool: createSearchRecordsTool,
        createGetRecordTool: createGetRecordTool,
        createGetRecordCountTool: createGetRecordCountTool,
        createCheckPermissionTool: createCheckPermissionTool,
        createGetUserContextTool: createGetUserContextTool
    };
});
