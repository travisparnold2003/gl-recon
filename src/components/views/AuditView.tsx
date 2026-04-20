"use client";

import { formatDate } from "@/lib/format";
import type { AuditEvent } from "@/types/dashboard";

type Props = {
  auditEvents: AuditEvent[];
};

export function AuditView({ auditEvents }: Props) {
  return (
    <section className="panel audit-panel">
      {auditEvents.map((event) => (
        <article className="audit-item" key={event.id}>
          <div className="audit-item-head">
            <div>
              <strong>{event.event_type}</strong>
              <p>{event.message}</p>
            </div>
            <span>{formatDate(event.created_at)}</span>
          </div>
          <pre>{JSON.stringify(event.details, null, 2)}</pre>
        </article>
      ))}
      {auditEvents.length === 0 && <p className="muted">No audit events yet.</p>}
    </section>
  );
}
