package com.syncboard.auth;

import com.syncboard.user.User;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;

/** Request/response bodies for {@link AuthController}. Passwords are capped at 72: BCrypt's input limit. */
public final class AuthDtos {

    private AuthDtos() {
    }

    public record RegisterRequest(
            @NotBlank(message = "{validation.email.required}")
            @Email(message = "{validation.email.invalid}")
            @Size(max = 255, message = "{validation.email.tooLong}")
            String email,

            @NotBlank(message = "{validation.password.required}")
            @Size(min = 8, max = 72, message = "{validation.password.length}")
            String password,

            @NotBlank(message = "{validation.fullName.required}")
            @Size(max = 100, message = "{validation.fullName.tooLong}")
            String fullName) {
    }

    public record LoginRequest(
            @NotBlank(message = "{validation.email.required}")
            String email,

            @NotBlank(message = "{validation.password.required}")
            @Size(max = 72, message = "{validation.password.tooLong}")
            String password) {
    }

    public record LoginResponse(String accessToken, String tokenType, long expiresIn) {
    }

    public record UserResponse(Long id, String email, String fullName, Instant createdAt) {

        static UserResponse from(User user) {
            return new UserResponse(user.getId(), user.getEmail(), user.getFullName(), user.getCreatedAt());
        }
    }
}
