package com.syncboard.chat;

import com.syncboard.chat.ChatDtos.ChatPage;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Older chat history. The newest page comes with the board's join reply and new messages over STOMP
 * ({@code /app/boards/{id}/chat}); there is no REST write.
 */
@RestController
@RequestMapping("/api/boards/{boardId}/messages")
public class ChatController {

    private final ChatService chat;

    public ChatController(ChatService chat) {
        this.chat = chat;
    }

    @GetMapping
    public ChatPage history(@AuthenticationPrincipal Jwt jwt, @PathVariable long boardId,
            @RequestParam(required = false) Long before, @RequestParam(required = false) Integer limit) {
        return chat.history(Long.parseLong(jwt.getSubject()), boardId, before, limit);
    }
}
