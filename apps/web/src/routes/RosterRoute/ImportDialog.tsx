import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import type { RosterImportReport } from '@hs/contracts';

import { queryKeys } from '../../api/query-keys';
import { importRoster } from '../../api/roster';
import { importButtonText, importSummary, sortRejections, type ImportState } from './presentation';

export function ImportDialog({
  onClose,
  returnFocusTo,
}: {
  onClose: () => void;
  returnFocusTo: RefObject<HTMLButtonElement | null>;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const fileId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<RosterImportReport | null>(null);

  useEffect(() => {
    const trigger = returnFocusTo.current;
    dialogRef.current?.showModal();

    return () => trigger?.focus();
  }, [returnFocusTo]);

  const rosterImport = useMutation({
    mutationFn: (selectedFile: File) => importRoster({ file: selectedFile }),
    onSuccess: (result) => {
      setReport(result);
      void queryClient.invalidateQueries({ queryKey: queryKeys.roster() });
    },
  });

  const state: ImportState = rosterImport.isPending
    ? 'pending'
    : rosterImport.isError
      ? 'error'
      : report
        ? 'success'
        : file
          ? 'ready'
          : 'empty';

  const close = (): void => {
    if (state !== 'pending') dialogRef.current?.close();
  };

  return (
    <dialog
      ref={dialogRef}
      className="modal import-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        if (state === 'pending') event.preventDefault();
      }}
      onClose={onClose}
    >
      <h2 id={titleId}>Import people</h2>
      <p className="modal__text">
        Rows for any site you administer may be applied, regardless of the site currently shown.
      </p>

      <form
        className="import-dialog__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (file && state !== 'pending') rosterImport.mutate(file);
        }}
      >
        <label htmlFor={fileId}>People CSV file</label>
        <input
          id={fileId}
          type="file"
          accept=".csv,text/csv"
          disabled={state === 'pending'}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setReport(null);
            rosterImport.reset();
          }}
        />

        <div className="modal__actions">
          <button type="submit" disabled={state === 'empty' || state === 'pending'}>
            {importButtonText(state)}
          </button>
          <button type="button" onClick={close} disabled={state === 'pending'}>
            Close
          </button>
        </div>
      </form>

      {state === 'pending' ? <p role="status">Importing people…</p> : null}
      {state === 'error' ? (
        <p role="alert" className="notice notice--warn">
          {rosterImport.error?.message ?? 'The people list could not be imported.'}
        </p>
      ) : null}

      {report ? (
        <section className="import-dialog__report" role="status" aria-label="Import result">
          <h3>Import result</h3>
          <p>{importSummary(report)}</p>

          {report.rejections.length > 0 ? (
            <div className="import-dialog__rejections" role="region" aria-label="Rejected rows" tabIndex={0}>
              <ol>
                {sortRejections(report.rejections).map((rejection) => (
                  <li key={`${rejection.row_number}-${rejection.reason}`}>
                    <strong>Row {rejection.row_number}:</strong> {rejection.reason}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </section>
      ) : null}
    </dialog>
  );
}
