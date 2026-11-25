package com.syncboard.config;

import java.util.List;
import java.util.Locale;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.LocaleResolver;
import org.springframework.web.servlet.i18n.AcceptHeaderLocaleResolver;

/**
 * The request language comes from Accept-Language (the frontend sends its UI language). Only English
 * and Korean are supported; anything else, or no header, falls back to English.
 */
@Configuration
public class LocaleConfig {

    private static final List<Locale> SUPPORTED = List.of(Locale.ENGLISH, Locale.KOREAN);

    /** The bean name must be "localeResolver" to replace Spring MVC's default. */
    @Bean
    LocaleResolver localeResolver() {
        AcceptHeaderLocaleResolver resolver = new AcceptHeaderLocaleResolver();
        resolver.setSupportedLocales(SUPPORTED);
        resolver.setDefaultLocale(Locale.ENGLISH);
        return resolver;
    }
}
