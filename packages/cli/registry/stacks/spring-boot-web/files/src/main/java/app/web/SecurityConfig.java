package app.web;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;

/**
 * Spring Security for its CSRF protection and response headers, with no sign-in yet: every page
 * is public. Every POST, PUT, PATCH and DELETE must carry the session's CSRF token, which
 * Thymeleaf adds to each {@code th:action} form as a hidden {@code _csrf} field; a request
 * without it gets the 403 error page. Sign-in goes here when the app needs it.
 */
@Configuration(proxyBeanMethods = false)
public class SecurityConfig {

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http.authorizeHttpRequests(requests -> requests.anyRequest().permitAll());
        return http.build();
    }

    /**
     * No accounts yet. Without this bean Spring Boot creates a development user and logs its
     * generated password at every start; a real user store replaces it.
     */
    @Bean
    UserDetailsService noUsers() {
        return new InMemoryUserDetailsManager();
    }
}
