package com.syncboard.chat;

import com.syncboard.board.BoardAccessService;
import com.syncboard.chat.ChatDtos.ChatMessageResponse;
import com.syncboard.chat.ChatDtos.ChatPage;
import com.syncboard.common.ApiException;
import com.syncboard.realtime.PresenceRegistry;
import com.syncboard.user.User;
import com.syncboard.user.UserRepository;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Limit;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Board chat: every role, viewers included, may read and write. Messages are stored before they are
 * broadcast, so their ids give the one order everybody shows them in.
 */
@Service
public class ChatService {

    /** Same limit as the frontend (chat/types.ts) and the messages.body column. */
    public static final int MAX_LENGTH = 2000;
    public static final int MAX_CLIENT_MESSAGE_ID = 64;
    /** Messages in the join reply and the default page size. */
    public static final int PAGE_SIZE = 50;
    public static final int MAX_PAGE_SIZE = 100;

    private final ChatMessageRepository messages;
    private final UserRepository users;
    private final BoardAccessService access;

    public ChatService(ChatMessageRepository messages, UserRepository users, BoardAccessService access) {
        this.messages = messages;
        this.users = users;
        this.access = access;
    }

    /**
     * Stores a message by a user who may view the board (checked here, on every message, so removed
     * members can't keep writing). Idempotent per {@code clientMessageId}: sending the same message
     * again returns the stored one.
     */
    public ChatMessageResponse post(long userId, String userName, long boardId, String clientMessageId, String text) {
        if (clientMessageId == null || clientMessageId.isEmpty() || clientMessageId.length() > MAX_CLIENT_MESSAGE_ID) {
            throw invalidMessage();
        }
        String body = text == null ? "" : text.strip();
        if (body.isEmpty() || body.length() > MAX_LENGTH) {
            throw invalidMessage();
        }
        access.requireView(userId, boardId);
        ChatMessage stored = messages.findByBoardIdAndUserIdAndClientMessageId(boardId, userId, clientMessageId)
                .orElseGet(() -> insert(new ChatMessage(boardId, userId, body, clientMessageId)));
        return toResponse(stored, userName);
    }

    /** A page of a board's messages, oldest first, older than {@code beforeId} if given. */
    @Transactional(readOnly = true)
    public ChatPage history(long userId, long boardId, Long beforeId, Integer limit) {
        access.requireView(userId, boardId);
        return page(boardId, beforeId, limit == null ? PAGE_SIZE : Math.clamp(limit, 1, MAX_PAGE_SIZE));
    }

    /** The newest messages, for the join reply (access is checked by the caller). */
    @Transactional(readOnly = true)
    public ChatPage latest(long boardId) {
        return page(boardId, null, PAGE_SIZE);
    }

    private ChatPage page(long boardId, Long beforeId, int limit) {
        Limit fetch = Limit.of(limit + 1); // one extra tells whether there are more
        List<ChatMessage> newestFirst = beforeId == null
                ? messages.findByBoardIdOrderByIdDesc(boardId, fetch)
                : messages.findByBoardIdAndIdLessThanOrderByIdDesc(boardId, beforeId, fetch);
        boolean hasMore = newestFirst.size() > limit;
        List<ChatMessage> page = new ArrayList<>(newestFirst.subList(0, Math.min(limit, newestFirst.size())));
        Collections.reverse(page);
        Map<Long, String> names = users.findAllById(page.stream().map(ChatMessage::getUserId).distinct().toList())
                .stream().collect(Collectors.toMap(User::getId, User::getFullName));
        return new ChatPage(page.stream().map(m -> toResponse(m, names.getOrDefault(m.getUserId(), ""))).toList(),
                hasMore);
    }

    /** Two copies of one message arriving at once (a re-send racing the original): keep the first. */
    private ChatMessage insert(ChatMessage message) {
        try {
            return messages.saveAndFlush(message);
        } catch (DataIntegrityViolationException e) {
            return messages.findByBoardIdAndUserIdAndClientMessageId(
                    message.getBoardId(), message.getUserId(), message.getClientMessageId()).orElseThrow(() -> e);
        }
    }

    private static ChatMessageResponse toResponse(ChatMessage m, String userName) {
        return new ChatMessageResponse(m.getId(), m.getUserId(), userName, PresenceRegistry.colorOf(m.getUserId()),
                m.getBody(), m.getCreatedAt(), m.getClientMessageId());
    }

    private static ApiException invalidMessage() {
        return new ApiException(HttpStatus.BAD_REQUEST, "INVALID_CHAT_MESSAGE", "error.invalidChatMessage");
    }
}
