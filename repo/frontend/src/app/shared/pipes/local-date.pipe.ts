import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'localDate'
})
export class LocalDatePipe implements PipeTransform {
  /**
   * Formats a date value as MM/DD/YYYY.
   * Accepts Date objects, ISO date strings, or timestamps.
   * Returns an empty string for null/undefined/invalid input.
   */
  transform(value: string | Date | number | null | undefined): string {
    if (value === null || value === undefined) {
      return '';
    }

    const date = value instanceof Date ? value : new Date(value);

    if (isNaN(date.getTime())) {
      return '';
    }

    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();

    return `${month}/${day}/${year}`;
  }
}
