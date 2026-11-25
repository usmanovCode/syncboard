package com.syncboard.auth;

import com.syncboard.auth.AuthDtos.LoginRequest;
import com.syncboard.auth.AuthDtos.LoginResponse;
import com.syncboard.auth.AuthDtos.RegisterRequest;
import com.syncboard.auth.AuthDtos.UserResponse;
import com.syncboard.common.ApiException;
import com.syncboard.user.User;
import com.syncboard.user.UserRepository;
import java.util.Locale;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {

    private final UserRepository users;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;

    public AuthService(UserRepository users, PasswordEncoder passwordEncoder, JwtService jwtService) {
        this.users = users;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
    }

    @Transactional
    public UserResponse register(RegisterRequest request) {
        String email = normalizeEmail(request.email());
        if (users.existsByEmail(email)) {
            throw new ApiException(HttpStatus.CONFLICT, "EMAIL_TAKEN", "error.emailTaken");
        }
        User user = new User(email, passwordEncoder.encode(request.password()), request.fullName().trim());
        return UserResponse.from(users.saveAndFlush(user));
    }

    @Transactional(readOnly = true)
    public LoginResponse login(LoginRequest request) {
        // Same error for unknown email and wrong password, so the endpoint doesn't reveal which emails exist.
        User user = users.findByEmail(normalizeEmail(request.email()))
                .filter(u -> passwordEncoder.matches(request.password(), u.getPasswordHash()))
                .orElseThrow(() -> new ApiException(
                        HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "error.invalidCredentials"));
        return new LoginResponse(jwtService.issueAccessToken(user), "Bearer", jwtService.ttlSeconds());
    }

    @Transactional(readOnly = true)
    public UserResponse currentUser(long userId) {
        return users.findById(userId)
                .map(UserResponse::from)
                .orElseThrow(() -> new ApiException(
                        HttpStatus.UNAUTHORIZED, "USER_NOT_FOUND", "error.userNotFound"));
    }

    static String normalizeEmail(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }
}
