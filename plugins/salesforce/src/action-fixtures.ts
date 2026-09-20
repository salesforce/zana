export const ACTION_AGENT = `config:
    agent_name: "Order_Assistant"

system:
    instructions: "Help customers track orders."

variables:
    order_id: mutable string = ""
    status: mutable string = ""

start_agent orders:
    description: "Find an order"
    actions:
        lookup:
            description: "Look up an order by its identifier"
            inputs:
                orderId: string
                    description: "The order identifier"
                    is_required: True
            outputs:
                status: string
                    description: "Delivery status"
            target: "apex://OrderLookup"
        refund:
            description: "Check whether a return can be requested"
            inputs:
                orderId: string
                    description: "The order identifier"
            outputs:
                eligible: boolean
                    description: "Return eligibility"
            target: "flow://CheckReturn"
    reasoning:
        instructions: ->
            | Ask for the order identifier.
            run @actions.lookup
                with orderId = @variables.order_id
                set @variables.status = @outputs.status
        actions:
            request_return: @actions.refund
                description: "Check return eligibility"
                with orderId = @variables.order_id

subagent returns:
    description: "Handle a return"
    actions:
        lookup:
            description: "Look up return eligibility"
            target: "flow://CheckReturn"
    reasoning:
        instructions: "Ask for the order."
`;
export const ACTION_APEX = `public with sharing class OrderLookup {
    public class Request {
        @InvocableVariable(required=true)
        public String orderId;
    }
    public class Result {
        @InvocableVariable
        public String status;
    }
    @InvocableMethod(label='Find order')
    public static List<Result> lookup(List<Request> requests) {
        return new List<Result>();
    }
}
`;
export const ACTION_FLOW = {
  label: 'Check return', processType: 'AutoLaunchedFlow',
  start: { connector: { targetReference: 'FindOrder' } },
  recordLookups: [{ name: 'FindOrder', label: 'Find order', object: 'Order', connector: { targetReference: 'Eligible' }, faultConnector: { targetReference: 'LogError' } }],
  decisions: [{ name: 'Eligible', label: 'Return eligible?', rules: [{ name: 'Yes', label: 'Within 30 days', connector: { targetReference: 'CreateReturn' } }], defaultConnector: { targetReference: 'Decline' }, defaultConnectorLabel: 'Outside return window' }],
  subflows: [{ name: 'CreateReturn', label: 'Create return', flowName: 'CreateReturn' }],
  assignments: [{ name: 'Decline', label: 'Explain policy' }],
  actionCalls: [{ name: 'LogError', label: 'Log lookup failure', actionName: 'OrderLookup', actionType: 'apex' }],
  variables: [{ name: 'orderId', dataType: 'String', isInput: true, isOutput: false }, { name: 'eligible', dataType: 'Boolean', isInput: false, isOutput: true }]
};
export const ACTION_FLOW_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
  <label>Check return</label><processType>AutoLaunchedFlow</processType>
  <start><connector><targetReference>FindOrder</targetReference></connector></start>
  <recordLookups><name>FindOrder</name><label>Find order</label><object>Order</object><connector><targetReference>Eligible</targetReference></connector><faultConnector><targetReference>LogError</targetReference></faultConnector></recordLookups>
  <decisions><name>Eligible</name><label>Return eligible?</label><rules><name>Yes</name><label>Within 30 days</label><connector><targetReference>CreateReturn</targetReference></connector></rules><defaultConnector><targetReference>Decline</targetReference></defaultConnector><defaultConnectorLabel>Outside return window</defaultConnectorLabel></decisions>
  <subflows><name>CreateReturn</name><label>Create return</label><flowName>CreateReturn</flowName></subflows>
  <assignments><name>Decline</name><label>Explain policy</label></assignments>
  <actionCalls><name>LogError</name><label>Log lookup failure</label><actionName>OrderLookup</actionName><actionType>apex</actionType></actionCalls>
  <variables><name>orderId</name><dataType>String</dataType><isInput>true</isInput><isOutput>false</isOutput></variables>
  <variables><name>eligible</name><dataType>Boolean</dataType><isInput>false</isInput><isOutput>true</isOutput></variables>
</Flow>`;
