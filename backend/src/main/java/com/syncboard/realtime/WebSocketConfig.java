package com.syncboard.realtime;

import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketTransportRegistration;

/**
 * STOMP over plain WebSocket at {@code /ws}. Each instance runs Spring's simple broker for its own
 * clients; {@link RealtimeBus} fans topic messages out to all instances through Redis Pub/Sub, and room
 * state and presence live in Redis ({@link BoardRooms}, {@link ClusterPresence}). So any number of
 * instances can run behind a load balancer (WebSocket-capable, no sticky sessions needed).
 */
@Configuration
@EnableScheduling // BoardRooms flushes rooms to the database; ClusterPresence sends heartbeats
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    /** A pen stroke is sent as one message; leave room for long strokes. */
    static final int MAX_MESSAGE_BYTES = 512 * 1024;

    private final StompAuthInterceptor authInterceptor;
    private final List<String> allowedOrigins;

    public WebSocketConfig(
            StompAuthInterceptor authInterceptor, @Value("${app.cors.allowed-origins}") List<String> allowedOrigins) {
        this.authInterceptor = authInterceptor;
        this.allowedOrigins = allowedOrigins;
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws").setAllowedOrigins(allowedOrigins.toArray(String[]::new));
        // Not setPreserveReceiveOrder: it runs StompAuthInterceptor asynchronously, so rejections no
        // longer reach the client as ERROR frames. Instead each client keeps at most one op in flight
        // (frontend useBoardRoom), so a client's ops cannot be reordered on the way in.
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.setApplicationDestinationPrefixes("/app");
        registry.setUserDestinationPrefix("/user");
        // Deliver to each client in publish order, i.e. in op seq order.
        registry.setPreservePublishOrder(true);
        // Heartbeats let the server notice dead connections (and drop their presence) within ~20 s.
        registry.enableSimpleBroker("/topic", "/queue")
                .setHeartbeatValue(new long[] {10_000, 10_000})
                .setTaskScheduler(heartbeatScheduler());
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(authInterceptor);
    }

    @Override
    public void configureWebSocketTransport(WebSocketTransportRegistration registration) {
        registration.setMessageSizeLimit(MAX_MESSAGE_BYTES).setSendBufferSizeLimit(4 * MAX_MESSAGE_BYTES);
    }

    @Bean
    ThreadPoolTaskScheduler heartbeatScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        // Also runs the @Scheduled jobs (room flushes, instance heartbeats), so STOMP heartbeats are not
        // delayed by database writes.
        scheduler.setPoolSize(3);
        scheduler.setThreadNamePrefix("ws-scheduler-");
        scheduler.initialize();
        return scheduler;
    }
}
