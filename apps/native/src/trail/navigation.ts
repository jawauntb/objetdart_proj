import type { NativeSceneId } from "@objet/universe-contracts";

export type NativeScenePath = "/world" | "/cell" | "/solar" | "/molecules" | "/atoms";

type DismissRouter = Readonly<{
  canGoBack?: () => boolean;
  back: () => void;
  replace: (path: NativeScenePath) => void;
}>;

export function pathForScene(scene: NativeSceneId): NativeScenePath {
  return scene === "wave" ? "/world" : `/${scene}`;
}

/** Close a pushed overlay without adding another scene route to the stack. */
export function dismissOverlay(router: DismissRouter, scene: NativeSceneId): void {
  if (router.canGoBack?.()) {
    router.back();
    return;
  }
  router.replace(pathForScene(scene));
}
