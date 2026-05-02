import { getTrpcServer } from "@/lib/trpc-server";
import { ANNOTATION_LIST_PAGE_SIZE, AnnotationsBrowser } from "./annotations-browser";

export async function AnnotationsPanel({
  projectId,
  projectName,
  primaryBranch,
}: {
  projectId: string;
  projectName: string;
  primaryBranch: string;
}) {
  const trpc = await getTrpcServer();
  const initialList = await trpc.annotations.list.query({
    projectId,
    limit: ANNOTATION_LIST_PAGE_SIZE,
  });

  return (
    <AnnotationsBrowser
      projectId={projectId}
      projectName={projectName}
      initialData={initialList}
      primaryBranch={primaryBranch}
    />
  );
}
