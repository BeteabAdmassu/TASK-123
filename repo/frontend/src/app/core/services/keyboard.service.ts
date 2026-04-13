import { Injectable } from '@angular/core';
import { Subject, Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class KeyboardService {
  private searchTriggeredSubject = new Subject<void>();
  private saveTriggeredSubject = new Subject<void>();
  private notificationTriggeredSubject = new Subject<void>();

  /** Emits when Ctrl+K is pressed (search dialog trigger) */
  searchTriggered$: Observable<void> = this.searchTriggeredSubject.asObservable();

  /** Emits when Ctrl+Enter is pressed (save/submit trigger) */
  saveTriggered$: Observable<void> = this.saveTriggeredSubject.asObservable();

  /** Emits when Alt+N is pressed (notification panel trigger) */
  notificationTriggered$: Observable<void> = this.notificationTriggeredSubject.asObservable();

  handleKeydown(event: KeyboardEvent): void {
    const ctrlOrMeta = event.ctrlKey || event.metaKey;

    // Ctrl+K: Open search
    if (ctrlOrMeta && event.key === 'k') {
      event.preventDefault();
      this.searchTriggeredSubject.next();
      return;
    }

    // Ctrl+S: Save
    if (ctrlOrMeta && event.key === 's') {
      event.preventDefault();
      this.saveTriggeredSubject.next();
      return;
    }

    // Ctrl+Enter: Save / Submit
    if (ctrlOrMeta && event.key === 'Enter') {
      event.preventDefault();
      this.saveTriggeredSubject.next();
      return;
    }

    // Alt+N: Open notifications
    if (event.altKey && (event.key === 'n' || event.key === 'N')) {
      event.preventDefault();
      this.notificationTriggeredSubject.next();
      return;
    }
  }
}
