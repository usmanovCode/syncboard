package com.syncboard.common;

import org.springframework.http.HttpStatus;

/**
 * Business error that maps directly to an HTTP status. {@code code} is a stable, machine-readable
 * identifier the frontend can switch on; {@code message} is shown to the user.
 */
public class ApiException extends RuntimeException {

    private final HttpStatus status;
    private final String code;

    public ApiException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public HttpStatus getStatus() {
        return status;
    }

    public String getCode() {
        return code;
    }
}
