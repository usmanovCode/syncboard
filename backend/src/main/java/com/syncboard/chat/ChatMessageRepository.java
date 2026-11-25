package com.syncboard.chat;

import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ChatMessageRepository extends JpaRepository<ChatMessage, Long> {

    /** Newest first. */
    List<ChatMessage> findByBoardIdOrderByIdDesc(Long boardId, Limit limit);

    /** Newest first, strictly older than {@code beforeId}. */
    List<ChatMessage> findByBoardIdAndIdLessThanOrderByIdDesc(Long boardId, Long beforeId, Limit limit);

    Optional<ChatMessage> findByBoardIdAndUserIdAndClientMessageId(Long boardId, Long userId, String clientMessageId);
}
