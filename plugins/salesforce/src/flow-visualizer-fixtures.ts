import { ACTION_FLOW } from './action-fixtures.js';

/** Small but non-linear fixture: merge, cycle, fault, scheduled and async paths. */
export const VISUALIZER_FLOW = {
  ...ACTION_FLOW,
  apiVersion: '62.0', status: 'Draft',
  start: { ...ACTION_FLOW.start, object: 'Order', triggerType: 'RecordAfterSave', recordTriggerType: 'CreateAndUpdate',
    scheduledPaths: [
      { name: 'Async', label: 'After commit', pathType: 'AsyncAfterCommit', connector: { targetReference: 'Notify' } },
      { name: 'Tomorrow', label: 'Tomorrow', offsetNumber: 1, offsetUnit: 'Days', timeSource: 'RecordField', recordField: 'CreatedDate', connector: { targetReference: 'Notify' } },
    ],
  },
  subflows: [{ ...ACTION_FLOW.subflows[0], connector: { targetReference: 'Items' } }],
  loops: [{ name: 'Items', label: 'Each order item', collectionReference: 'orderItems', iterationOrder: 'Asc',
    nextValueConnector: { targetReference: 'UpdateLine' }, noMoreValuesConnector: { targetReference: 'Notify' } }],
  assignments: [...ACTION_FLOW.assignments,
    { name: 'UpdateLine', label: 'Prepare line item', connector: { targetReference: 'Items' } },
    { name: 'Notify', label: 'Send confirmation' }],
  variables: [...ACTION_FLOW.variables, { name: 'orderItems', dataType: 'SObject', objectType: 'OrderItem', isCollection: true, isInput: false, isOutput: false }],
};
