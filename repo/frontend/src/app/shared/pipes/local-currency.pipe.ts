import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'localCurrency'
})
export class LocalCurrencyPipe implements PipeTransform {
  /**
   * Formats a number as USD currency: $1,234.00
   * Accepts numbers or numeric strings.
   * Returns an empty string for null/undefined/invalid input.
   */
  transform(value: number | string | null | undefined, decimals: number = 2): string {
    if (value === null || value === undefined) {
      return '';
    }

    const numericValue = typeof value === 'string' ? parseFloat(value) : value;

    if (isNaN(numericValue)) {
      return '';
    }

    const formatted = numericValue.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });

    return formatted;
  }
}
