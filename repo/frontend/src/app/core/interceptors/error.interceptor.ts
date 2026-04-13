import { Injectable } from '@angular/core';
import {
  HttpInterceptor,
  HttpRequest,
  HttpHandler,
  HttpEvent,
  HttpErrorResponse
} from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';

import { AuthService } from '../auth/auth.service';

@Injectable()
export class ErrorInterceptor implements HttpInterceptor {
  constructor(
    private authService: AuthService,
    private router: Router,
    private snackBar: MatSnackBar
  ) {}

  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    return next.handle(req).pipe(
      catchError((error: HttpErrorResponse) => {
        if (error.status === 401) {
          // Skip redirect for login endpoint
          if (!req.url.includes('/auth/login')) {
            this.snackBar.open('Session expired. Please log in again.', 'Close', {
              duration: 3000
            });
            this.router.navigate(['/login']);
          }
        } else if (error.status === 403) {
          this.snackBar.open('You do not have permission to perform this action.', 'Close', {
            duration: 3000
          });
        } else if (error.status >= 500) {
          this.snackBar.open('A server error occurred. Please try again later.', 'Close', {
            duration: 4000
          });
        }

        return throwError(() => error);
      })
    );
  }
}
