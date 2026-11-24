package com.syncboard.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.syncboard.auth.AuthDtos.LoginRequest;
import com.syncboard.auth.AuthDtos.RegisterRequest;
import com.syncboard.common.ApiException;
import com.syncboard.user.User;
import com.syncboard.user.UserRepository;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;

class AuthServiceTest {

    private final UserRepository users = mock(UserRepository.class);
    private final PasswordEncoder passwordEncoder = mock(PasswordEncoder.class);
    private final JwtService jwtService = mock(JwtService.class);
    private final AuthService service = new AuthService(users, passwordEncoder, jwtService);

    @Test
    void registerRejectsExistingEmailCaseInsensitively() {
        when(users.existsByEmail("ali@example.com")).thenReturn(true);

        assertThatThrownBy(() -> service.register(new RegisterRequest(" Ali@Example.com ", "password1", "Ali")))
                .isInstanceOfSatisfying(ApiException.class, ex -> {
                    assertThat(ex.getStatus()).isEqualTo(HttpStatus.CONFLICT);
                    assertThat(ex.getCode()).isEqualTo("EMAIL_TAKEN");
                });
        verify(users, never()).saveAndFlush(any());
    }

    @Test
    void loginWithWrongPasswordFailsWithoutIssuingToken() {
        User user = new User("ali@example.com", "stored-hash", "Ali");
        when(users.findByEmail("ali@example.com")).thenReturn(Optional.of(user));
        when(passwordEncoder.matches("wrong", "stored-hash")).thenReturn(false);

        assertThatThrownBy(() -> service.login(new LoginRequest("ali@example.com", "wrong")))
                .isInstanceOfSatisfying(ApiException.class,
                        ex -> assertThat(ex.getStatus()).isEqualTo(HttpStatus.UNAUTHORIZED));
        verify(jwtService, never()).issueAccessToken(any());
    }

    @Test
    void loginWithUnknownEmailGivesSameErrorAsWrongPassword() {
        when(users.findByEmail("nobody@example.com")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.login(new LoginRequest("nobody@example.com", "whatever")))
                .isInstanceOfSatisfying(ApiException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo("INVALID_CREDENTIALS"));
    }
}
