package com.syncboard.common;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.context.MessageSource;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

/**
 * All errors are returned as RFC 9457 {@code ProblemDetail} JSON:
 * {@code { status, title, detail, code, errors? }}. {@code errors} maps field name to message for
 * validation failures. {@code detail} and field messages are in the request's language
 * (Accept-Language, see {@code LocaleConfig}). The frontend's {@code ApiError} parses exactly this shape.
 */
@RestControllerAdvice
public class GlobalExceptionHandler extends ResponseEntityExceptionHandler {

    private final MessageSource messages;

    public GlobalExceptionHandler(MessageSource messages) {
        this.messages = messages;
    }

    @ExceptionHandler(ApiException.class)
    ProblemDetail handleApiException(ApiException ex) {
        return problem(ex.getStatus(), ex.getCode(), ex.getMessageKey());
    }

    /**
     * Constraint violations that slipped past the service checks. The email one is the register race:
     * two requests pass existsByEmail before either inserts. Anything else is a generic conflict.
     */
    @ExceptionHandler(DataIntegrityViolationException.class)
    ProblemDetail handleDataIntegrity(DataIntegrityViolationException ex) {
        String cause = String.valueOf(ex.getMostSpecificCause().getMessage());
        return cause.contains("uk_users_email")
                ? problem(HttpStatus.CONFLICT, "EMAIL_TAKEN", "error.emailTaken")
                : problem(HttpStatus.CONFLICT, "DATA_CONFLICT", "error.dataConflict");
    }

    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(
            MethodArgumentNotValidException ex, HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        Map<String, String> errors = new LinkedHashMap<>();
        for (FieldError error : ex.getBindingResult().getFieldErrors()) {
            errors.putIfAbsent(error.getField(), error.getDefaultMessage());
        }
        // Field messages are already localized: Bean Validation resolves {validation.*} keys through
        // the MessageSource in the request locale.
        ProblemDetail problem = problem(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "error.validationFailed");
        problem.setProperty("errors", errors);
        return ResponseEntity.badRequest().body(problem);
    }

    private ProblemDetail problem(HttpStatus status, String code, String messageKey) {
        String detail = messages.getMessage(messageKey, null, messageKey, LocaleContextHolder.getLocale());
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
        problem.setProperty("code", code);
        return problem;
    }
}
