import React from 'react';
import type { ScheduledTask } from '@zana-ai/zcc-domain/product';
import { Modal } from '../Modal.js';

interface DeleteConfirmModalProps {
  task: ScheduledTask;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteConfirmModal({ task, onCancel, onConfirm }: DeleteConfirmModalProps) {
  return (
    <Modal
      title="Delete schedule?"
      onClose={onCancel}
      bodyClassName="scheduler-confirm-body"
      className="scheduler-confirm-modal"
      footer={
        <>
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn danger" onClick={onConfirm} autoFocus>
            Delete
          </button>
        </>
      }
    >
      This will permanently remove <strong>{task.name}</strong>. The
      on-disk JSON file is deleted; runs in progress are not interrupted.
    </Modal>
  );
}
