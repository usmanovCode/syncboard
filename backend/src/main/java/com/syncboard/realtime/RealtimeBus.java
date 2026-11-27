package com.syncboard.realtime;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PreDestroy;
import java.nio.charset.StandardCharsets;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Lazy;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.listener.PatternTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.stereotype.Component;
import org.springframework.util.MimeTypeUtils;

/**
 * Fans broker topics out to every backend instance through Redis Pub/Sub. Messages for
 * {@code /topic/...} are never sent to the local broker directly: they are published to the channel
 * {@code <prefix>:ws:<destination>}, and every instance (the sender's too) delivers what it receives to
 * its own clients. So all instances see one order, the order Redis received them in; that is also seq
 * order for ops, which are published by the Lua script that numbers them ({@link RedisScripts#APPLY}).
 * <p>
 * {@code /user/queue/errors} stays local: errors go to the session that caused them, on this instance.
 */
@Component
public class RealtimeBus implements MessageListener {

    private final StringRedisTemplate redis;
    private final RealtimeKeys keys;
    private final ObjectMapper json;
    private final SimpMessagingTemplate messaging;

    // Lazy: the broker template depends on the WebSocket configuration, which depends on the controller.
    public RealtimeBus(StringRedisTemplate redis, RealtimeKeys keys, ObjectMapper json,
            @Lazy SimpMessagingTemplate messaging) {
        this.redis = redis;
        this.keys = keys;
        this.json = json;
        this.messaging = messaging;
    }

    /** Sends {@code payload} (serialized as JSON) to the subscribers of {@code destination} on every instance. */
    public void publish(String destination, Object payload) {
        redis.convertAndSend(keys.channel(destination), toJson(payload));
    }

    String toJson(Object payload) {
        try {
            return json.writeValueAsString(payload);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    /** A message from Redis: hand it to this instance's broker, as is. */
    @Override
    public void onMessage(Message message, byte[] pattern) {
        String channel = new String(message.getChannel(), StandardCharsets.UTF_8);
        String destination = channel.substring(keys.channelPrefix().length());
        SimpMessageHeaderAccessor headers = SimpMessageHeaderAccessor.create(SimpMessageType.MESSAGE);
        headers.setContentType(MimeTypeUtils.APPLICATION_JSON);
        headers.setLeaveMutable(true);
        messaging.send(destination, MessageBuilder.createMessage(message.getBody(), headers.getMessageHeaders()));
    }

    @Configuration
    static class Config {

        /**
         * One thread: messages reach the broker in the order Redis delivered them (the container's
         * default executor would hand each message to a new thread). Not a bean, so it doesn't replace
         * Spring Boot's application task executor.
         */
        private final ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();

        @Bean
        RedisMessageListenerContainer realtimeListenerContainer(RedisConnectionFactory connections, RealtimeBus bus,
                RealtimeKeys keys) {
            executor.setCorePoolSize(1);
            executor.setMaxPoolSize(1);
            executor.setThreadNamePrefix("realtime-bus-");
            executor.initialize();
            RedisMessageListenerContainer container = new RedisMessageListenerContainer();
            container.setConnectionFactory(connections);
            container.setTaskExecutor(executor);
            container.addMessageListener(bus, new PatternTopic(keys.channelPrefix() + "/topic/*"));
            return container;
        }

        @PreDestroy
        void shutdown() {
            executor.shutdown();
        }
    }
}
