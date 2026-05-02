import type { AnnotationStreamEvent } from "@remarks/shared";

export interface AnnotationStreamCacheUtils {
  invalidateList(): Promise<unknown>;
  invalidateAnnotation(id: string): Promise<unknown>;
  invalidateAnnotationEvents(id: string): Promise<unknown>;
}

export function applyStreamEventToCache(
  event: AnnotationStreamEvent,
  utils: AnnotationStreamCacheUtils
): Promise<unknown> {
  const { type, annotationId } = event;

  switch (type) {
    case "created":
      return utils.invalidateList();

    case "status_changed":
    case "intent_changed":
    case "severity_changed":
    case "resolved":
      return Promise.all([utils.invalidateList(), utils.invalidateAnnotation(annotationId)]);

    case "comment_added":
    case "agent_commented":
    case "agent_acknowledged":
    case "agent_updated_status":
    case "comment_edited":
      return Promise.all([
        utils.invalidateAnnotationEvents(annotationId),
        utils.invalidateAnnotation(annotationId),
      ]);

    case "assigned":
    case "pr_linked":
    case "asset_attached":
      return utils.invalidateAnnotation(annotationId);

    default: {
      const _exhaustive: never = type;
      void _exhaustive;
      return Promise.resolve();
    }
  }
}
