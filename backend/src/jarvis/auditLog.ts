import type { JarvisAuditEvent } from './contracts.js';

export interface JarvisAuditSink {
  append(event: JarvisAuditEvent): void;
  list(): JarvisAuditEvent[];
}

/** In-memory implementation for the first slice; persistence will be encrypted later. */
export class InMemoryJarvisAuditLog implements JarvisAuditSink {
  private readonly events: JarvisAuditEvent[] = [];

  append(event: JarvisAuditEvent): void {
    this.events.push({ ...event });
  }

  list(): JarvisAuditEvent[] {
    return this.events.map((event) => ({ ...event }));
  }
}

