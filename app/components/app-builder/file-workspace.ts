import type { ProjectTextFile } from '#shared/contract'

export interface OpenProjectFile extends ProjectTextFile {
  projectId: string
  draft: string
}

/** Editor tabs survive switching files, projects, and the docked pane. */
export class FileWorkspace {
  documents: OpenProjectFile[] = []
  activePaths: Record<string, string | undefined> = {}

  get dirty (): boolean {
    return this.documents.some(document => document.draft !== document.content)
  }

  tabs (projectId: string): OpenProjectFile[] {
    return this.documents.filter(document => document.projectId === projectId)
  }

  active (projectId: string): OpenProjectFile | null {
    return this.tabs(projectId).find(document => document.path === this.activePaths[projectId]) ?? null
  }

  open (projectId: string, file: ProjectTextFile): OpenProjectFile {
    let document = this.tabs(projectId).find(document => document.path === file.path)
    if (!document) {
      document = { ...file, projectId, draft: file.content }
      this.documents.push(document)
    }
    this.activePaths[projectId] = document.path
    return document
  }

  close (document: OpenProjectFile, discard = false): boolean {
    if (!discard && document.draft !== document.content) {
      return false
    }
    this.documents = this.documents.filter(entry => entry.projectId !== document.projectId || entry.path !== document.path)
    if (this.activePaths[document.projectId] === document.path) {
      this.activePaths[document.projectId] = this.tabs(document.projectId).at(-1)?.path
    }
    return true
  }

  saved (document: OpenProjectFile, file: ProjectTextFile): void {
    document.content = file.content
    document.revision = file.revision
  }

  discardAll (): void {
    for (const document of this.documents) {
      document.draft = document.content
    }
  }
}
