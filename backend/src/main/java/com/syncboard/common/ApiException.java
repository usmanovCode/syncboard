package com.syncboard.common;

import org.springframework.http.HttpStatus;

/**
 * Business error that maps directly to an HTTP status. {@code code} is a stable, machine-readable
 * identifier the frontend can switch on. {@code messageKey} is a key in {@code messages*.properties};
 * {@link GlobalExceptionHandler} resolves it in the request's language (Accept-Language).
 */
public class ApiException extends RuntimeException {

    private final HttpStatus status;
    private final String code;
    private final String messageKey;

    public ApiException(HttpStatus status, String code, String messageKey) {
        super(code + " (" + messageKey + ")");
        this.status = status;
        this.code = code;
        this.messageKey = messageKey;
    }

    public HttpStatus getStatus() {
        return status;
    }

    public String getCode() {
        return code;
    }

    public String getMessageKey() {
        return messageKey;
    }
}
