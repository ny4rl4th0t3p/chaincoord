package api

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// GET /launch/{id}/events
// Server-Sent Events stream for live launch updates.
// Each event is a JSON-encoded domain event.
//
// @Summary      Subscribe to launch events (SSE)
// @Description  Server-Sent Events stream. Each SSE event carries a JSON-encoded domain event. Connect and listen for live updates.
// @Tags         events
// @Produce      text/event-stream
// @Param        id   path     string  true  "Launch UUID"
// @Success      200  {string} string  "SSE stream — events formatted as: event: <name>\ndata: <json>\n\n"
// @Failure      400  {object} errorEnvelope
// @Failure      404  {object} errorEnvelope
// @Router       /launch/{id}/events [get]
func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	launchID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_id", "launch id must be a valid UUID")
		return
	}

	// Visibility check.
	callerAddr := operatorFromContext(r.Context())
	if _, err := s.launches.GetLaunch(r.Context(), launchID, callerAddr); err != nil {
		writeServiceError(w, r, err)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "sse_unsupported", "streaming not supported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // disable nginx buffering
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	ch := s.sseBroker.Subscribe(launchID.String())
	defer s.sseBroker.Unsubscribe(launchID.String(), ch)

	for {
		select {
		case <-r.Context().Done():
			return
		case ev, ok := <-ch:
			if !ok {
				return
			}
			data, err := json.Marshal(ev)
			if err != nil {
				continue
			}
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.EventName(), data)
			flusher.Flush()
		}
	}
}
