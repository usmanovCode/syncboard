package com.syncboard.realtime;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.lang.reflect.Type;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.springframework.messaging.converter.CompositeMessageConverter;
import org.springframework.messaging.converter.MappingJackson2MessageConverter;
import org.springframework.messaging.converter.StringMessageConverter;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;

/** A real STOMP-over-WebSocket client for integration tests; messages are collected into queues. */
final class StompTestClient implements AutoCloseable {

    private static final long TIMEOUT_SECONDS = 5;

    /** ERROR frames and transport failures, as text. */
    final BlockingQueue<String> errors = new LinkedBlockingQueue<>();
    private final WebSocketStompClient client;
    private StompSession session;

    private StompTestClient(ObjectMapper json) {
        client = new WebSocketStompClient(new StandardWebSocketClient());
        MappingJackson2MessageConverter jackson = new MappingJackson2MessageConverter();
        jackson.setObjectMapper(json);
        client.setMessageConverter(new CompositeMessageConverter(List.of(new StringMessageConverter(), jackson)));
    }

    /** Connects; {@code token} may be null to send no Authorization header. Fails if not connected in time. */
    static StompTestClient connect(int port, ObjectMapper json, String token, String language) throws Exception {
        StompTestClient c = new StompTestClient(json);
        c.session = c.connectAsync(port, token, language).get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        return c;
    }

    static StompTestClient connect(int port, ObjectMapper json, String token) throws Exception {
        return connect(port, json, token, null);
    }

    /** Tries to connect and returns the error the server answered with. */
    static String connectExpectingError(int port, ObjectMapper json, String token) throws Exception {
        StompTestClient c = new StompTestClient(json);
        try (c) {
            c.connectAsync(port, token, null);
            String error = c.errors.poll(TIMEOUT_SECONDS, TimeUnit.SECONDS);
            if (error == null) {
                throw new AssertionError("Expected the connection to be rejected");
            }
            return error;
        }
    }

    private java.util.concurrent.CompletableFuture<StompSession> connectAsync(int port, String token, String language) {
        StompHeaders connect = new StompHeaders();
        if (token != null) {
            connect.add("Authorization", "Bearer " + token);
        }
        if (language != null) {
            connect.add("accept-language", language);
        }
        return client.connectAsync("ws://localhost:" + port + "/ws", new WebSocketHttpHeaders(), connect,
                new StompSessionHandlerAdapter() {
                    @Override
                    public Type getPayloadType(StompHeaders headers) {
                        return String.class;
                    }

                    @Override
                    public void handleFrame(StompHeaders headers, Object payload) {
                        errors.add(headers.getFirst("message") + " " + payload);
                    }

                    @Override
                    public void handleTransportError(StompSession s, Throwable exception) {
                        errors.add("transport: " + exception.getMessage());
                    }
                });
    }

    /** Subscribes and returns the queue the messages arrive in. */
    BlockingQueue<JsonNode> subscribe(String destination) {
        BlockingQueue<JsonNode> queue = new LinkedBlockingQueue<>();
        session.subscribe(destination, new StompFrameHandler() {
            @Override
            public Type getPayloadType(StompHeaders headers) {
                return JsonNode.class;
            }

            @Override
            public void handleFrame(StompHeaders headers, Object payload) {
                queue.add((JsonNode) payload);
            }
        });
        return queue;
    }

    void send(String destination, Object payload) {
        session.send(destination, payload);
    }

    boolean isConnected() {
        return session != null && session.isConnected();
    }

    static JsonNode next(BlockingQueue<JsonNode> queue) throws InterruptedException {
        JsonNode message = queue.poll(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        if (message == null) {
            throw new AssertionError("No message within " + TIMEOUT_SECONDS + " s");
        }
        return message;
    }

    /** Asserts nothing arrives for a short while. */
    static void assertQuiet(BlockingQueue<?> queue) throws InterruptedException {
        Object message = queue.poll(300, TimeUnit.MILLISECONDS);
        if (message != null) {
            throw new AssertionError("Unexpected message: " + message);
        }
    }

    @Override
    public void close() {
        try {
            if (session != null && session.isConnected()) {
                session.disconnect();
            }
        } catch (RuntimeException ignored) {
            // The server may already have closed the session (e.g. after an ERROR frame).
        }
        client.stop();
    }
}
