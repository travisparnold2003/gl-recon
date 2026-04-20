"use client";

import { formatDate, formatMoney } from "@/lib/format";
import type { Journal } from "@/types/dashboard";

type Props = {
  journals: Journal[];
  busy: boolean;
  onExport: () => void;
};

export function JournalsView({ journals, busy, onExport }: Props) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Posted Journals</h3>
        <button className="btn" disabled={busy} onClick={onExport}>Export CSV</button>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Description</th>
            <th>Debit</th>
            <th>Credit</th>
            <th>Amount</th>
            <th>Reference</th>
          </tr>
        </thead>
        <tbody>
          {journals.map((journal) => (
            <tr key={journal.id}>
              <td>{formatDate(journal.date)}</td>
              <td>{journal.description}</td>
              <td>{journal.debitAccount}</td>
              <td>{journal.creditAccount}</td>
              <td>{formatMoney(journal.amount)}</td>
              <td>{journal.reference}</td>
            </tr>
          ))}
          {journals.length === 0 && (
            <tr><td colSpan={6}>No journals posted yet.</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
