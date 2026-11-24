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
            @NotBlank(message = "Email kiritilishi shart")
            @Email(message = "Email formati noto'g'ri")
            @Size(max = 255, message = "Email juda uzun")
            String email,

            @NotBlank(message = "Parol kiritilishi shart")
            @Size(min = 8, max = 72, message = "Parol 8 dan 72 gacha belgidan iborat bo'lishi kerak")
            String password,

            @NotBlank(message = "Ism kiritilishi shart")
            @Size(max = 100, message = "Ism juda uzun")
            String fullName) {
    }

    public record LoginRequest(
            @NotBlank(message = "Email kiritilishi shart")
            String email,

            @NotBlank(message = "Parol kiritilishi shart")
            @Size(max = 72, message = "Parol juda uzun")
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
