import { HTTP_INTERCEPTORS, HttpEvent } from '@angular/common/http';
import {
  HttpHandler,
  HttpInterceptor,
  HttpRequest
} from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../environments/environment';

/**
 * When environment.apiBaseUrl is set, rewrites relative API requests to that origin.
 * Use when the frontend is served from one host (e.g. Vercel) and the Ghostfolio API from another (e.g. Nest on Railway).
 */
@Injectable()
export class ApiBaseUrlInterceptor implements HttpInterceptor {
  public intercept(
    req: HttpRequest<unknown>,
    next: HttpHandler
  ): Observable<HttpEvent<unknown>> {
    const base = environment.apiBaseUrl?.trim();
    if (!base || !req.url.startsWith('/')) {
      return next.handle(req);
    }
    const baseUrl = base.replace(/\/$/, '');
    const newUrl = `${baseUrl}${req.url}`;
    return next.handle(req.clone({ url: newUrl }));
  }
}

export const apiBaseUrlInterceptorProviders = [
  { provide: HTTP_INTERCEPTORS, useClass: ApiBaseUrlInterceptor, multi: true }
];
