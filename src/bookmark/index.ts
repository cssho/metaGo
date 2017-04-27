import * as vscode from "vscode";
import fs = require("fs");
import path = require("path");

import { BookmarkItem } from "./document";
import { Bookmark } from './bookmark';
import { BookmarkManager, JumpDirection } from './manager';
import { BookmarkConfig } from './config';
import { Storage } from './storage';
import { Decoration } from './decoration';
import { Selection } from './selection';
import { StickyBookmark } from './sticky';
export class BookmarkExt {
    private manager: BookmarkManager;
    private storage: Storage;
    private decoration: Decoration;
    private selection: Selection;
    private sticky: StickyBookmark;

    constructor(private context: vscode.ExtensionContext, private config: BookmarkConfig) {
        this.manager = new BookmarkManager();
        this.storage = new Storage(this.config, this.context, this.manager);
        this.decoration = new Decoration(this.config, this.context, this.manager);
        this.selection = new Selection(this.manager);
        this.sticky = new StickyBookmark(this.manager);

        this.storage.load();
        let activeEditorCountLine: number;

        // Timeout
        let timeout = null;
        let triggerUpdateDecorations = () => {
            if (timeout) {
                clearTimeout(timeout);
            }
            timeout = setTimeout(this.decoration.update, 100);
        }

        let activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            this.manager.activeDocument = this.manager.addDocumentIfNotExist(activeEditor.document.uri.fsPath);
            triggerUpdateDecorations();
        }

        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                this.manager.activeDocument = this.manager.addDocumentIfNotExist(editor.document.uri.fsPath);
                triggerUpdateDecorations();
            }
        }, null, context.subscriptions);

        vscode.workspace.onDidOpenTextDocument(doc => {
            this.manager.addDocumentIfNotExist(doc.uri.fsPath);
        });

        vscode.workspace.onDidChangeTextDocument(event => {
            if (activeEditor && event.document === activeEditor.document) {
                let updatedBookmark: boolean = true;
                // call sticky function when the activeEditor is changed
                if (this.manager.activeDocument && this.manager.activeDocument.bookmarks.length > 0) {
                    updatedBookmark = this.sticky.stickyBookmarks(event);
                }

                activeEditorCountLine = event.document.lineCount;
                this.decoration.update();

                if (updatedBookmark) {
                    this.storage.save();
                }
            }
        }, null, context.subscriptions);
        this.registerCommands();
    }

    private expandLineRange(editor: vscode.TextEditor, toLine: number, direction: JumpDirection) {
        const doc = editor.document;
        let newSe: vscode.Selection;
        let actualSelection: vscode.Selection = editor.selection;

        // no matter 'the previous selection'. going FORWARD will become 'isReversed = FALSE'
        if (direction === JumpDirection.FORWARD) {

            if (actualSelection.isEmpty || !actualSelection.isReversed) {
                newSe = new vscode.Selection(editor.selection.start.line, editor.selection.start.character, toLine, doc.lineAt(toLine).text.length);
            } else {
                newSe = new vscode.Selection(editor.selection.end.line, editor.selection.end.character, toLine, doc.lineAt(toLine).text.length);
            }
        } else { // going BACKWARD will become 'isReversed = TRUE'

            if (actualSelection.isEmpty || !actualSelection.isReversed) {
                newSe = new vscode.Selection(editor.selection.start.line, editor.selection.start.character, toLine, 0);
            } else {
                newSe = new vscode.Selection(editor.selection.end.line, editor.selection.end.character, toLine, 0);
            }
        }
        editor.selection = newSe;
    }

    private shrinkLineRange(editor: vscode.TextEditor, toLine: number, direction: JumpDirection) {
        const doc = editor.document;
        let newSe: vscode.Selection;

        // no matter 'the previous selection'. going FORWARD will become 'isReversed = FALSE'
        if (direction === JumpDirection.FORWARD) {
            newSe = new vscode.Selection(editor.selection.end.line, editor.selection.end.character, toLine, 0);
        } else { // going BACKWARD , select to line length
            newSe = new vscode.Selection(editor.selection.start.line, editor.selection.start.character, toLine, doc.lineAt(toLine).text.length);
        }
        editor.selection = newSe;
    }

    private revealLine(location: Bookmark) {
        let reviewType = vscode.TextEditorRevealType.InCenter;
        if (location.line === vscode.window.activeTextEditor.selection.active.line) {
            reviewType = vscode.TextEditorRevealType.InCenterIfOutsideViewport;
        }
        let newSe = new vscode.Selection(location.line, location.char, location.line, location.char);
        vscode.window.activeTextEditor.selection = newSe;
        vscode.window.activeTextEditor.revealRange(newSe, reviewType);
    }

    private removeRootPathFrom(path: string): string {
        if (!vscode.workspace.rootPath) {
            return path;
        }

        if (path.indexOf(vscode.workspace.rootPath) === 0) {
            return "$(tag) " + path.split(vscode.workspace.rootPath).pop();
        } else {
            return "$(link) " + path;
        }
    }


    private registerCommands() {
        vscode.commands.registerCommand("metaGo.bookmark.expandSelectionToNext", () => this.selection.expandSelectionToNextBookmark(JumpDirection.FORWARD));
        vscode.commands.registerCommand("metaGo.bookmark.expandSelectionToPrevious", () => this.selection.expandSelectionToNextBookmark(JumpDirection.BACKWARD));
        vscode.commands.registerCommand("metaGo.bookmark.shrinkSelection", () => this.selection.shrinkSelection());

        vscode.commands.registerCommand("metaGo.bookmark.clearInFile", () => {

            if (!vscode.window.activeTextEditor) {
                vscode.window.showInformationMessage("Open a file first to clear bookmarks");
                return;
            }

            this.manager.activeDocument.clear();

            this.storage.save();
            this.decoration.clear();
        });

        vscode.commands.registerCommand("metaGo.bookmark.clear", () => {
            this.manager.clear();
            this.storage.save();
            this.decoration.clear();
        });

        function selectLines(editor: vscode.TextEditor, lines: Bookmark[]): void {
            const doc = editor.document;
            editor.selections.shift();
            let selections = new Array<vscode.Selection>();
            let newSe;
            lines.forEach(line => {
                newSe = new vscode.Selection(line.line, 0, line.line, doc.lineAt(line.line).text.length);
                selections.push(newSe);
            });
            editor.selections = selections;
        }

        vscode.commands.registerCommand("metaGo.bookmark.selectLines", () => {
            if (!vscode.window.activeTextEditor) {
                vscode.window.showInformationMessage("Open a file first to clear bookmarks");
                return;
            }

            if (this.manager.activeDocument.bookmarks.length === 0) {
                vscode.window.showInformationMessage("No Bookmark found");
                return;
            }

            selectLines(vscode.window.activeTextEditor, this.manager.activeDocument.bookmarks);
        });

        vscode.commands.registerCommand("metaGo.bookmark.toggle", () => {
            this.manager.toggleBookmark();
            this.storage.save();
            this.decoration.update();
        });

        vscode.commands.registerCommand("metaGo.bookmark.jumpToNext", () => {
            if (!vscode.window.activeTextEditor) {
                vscode.window.showInformationMessage("Open a file first to jump to bookmarks");
                return;
            }

            if (!this.manager.activeDocument) {
                return;
            }

            this.manager.activeDocument.nextBookmark(vscode.window.activeTextEditor.selection.active)
                .then((nextLine) => {
                    if ((nextLine === Bookmark.NO_MORE_BOOKMARKS) || (nextLine === Bookmark.NO_BOOKMARKS)) {
                        this.manager.nextDocumentWithBookmarks(this.manager.activeDocument)
                            .then((nextDocumentPath) => {
                                if (!nextDocumentPath) {
                                    return;
                                }

                                // same document?
                                let activeDocumentPath = BookmarkManager.normalize(vscode.window.activeTextEditor.document.uri.fsPath);
                                if (nextDocumentPath.toString() === activeDocumentPath) {
                                    let location = this.manager.activeDocument.bookmarks[0];
                                    this.revealLine(location);
                                } else {
                                    vscode.workspace.openTextDocument(nextDocumentPath.toString()).then(doc => {
                                        vscode.window.showTextDocument(doc).then(editor => {
                                            let location = this.manager.activeDocument.bookmarks[0];
                                            this.revealLine(location);
                                        });
                                    });
                                }
                            })
                            .catch((error) => {
                                vscode.window.showInformationMessage("No more bookmarks...");
                            });
                    } else {
                        this.revealLine(nextLine);
                    }
                })
                .catch((error) => {
                    console.log("activeBookmark.nextBookmark REJECT" + error);
                });
        });

        vscode.commands.registerCommand("metaGo.bookmark.jumpToPrevious", () => {
            if (!vscode.window.activeTextEditor) {
                vscode.window.showInformationMessage("Open a file first to jump to this.bookmarks");
                return;
            }

            if (!this.manager.activeDocument) {
                return;
            }

            this.manager.activeDocument.nextBookmark(vscode.window.activeTextEditor.selection.active, JumpDirection.BACKWARD)
                .then((location) => {
                    if ((location === Bookmark.NO_MORE_BOOKMARKS) || (location === Bookmark.NO_BOOKMARKS)) {
                        this.manager.nextDocumentWithBookmarks(this.manager.activeDocument, JumpDirection.BACKWARD)
                            .then((nextDocument) => {

                                if (!nextDocument) {
                                    return;
                                }

                                // same document?
                                let activeDocument = BookmarkManager.normalize(vscode.window.activeTextEditor.document.uri.fsPath);
                                if (nextDocument.toString() === activeDocument) {
                                    let locations = this.manager.activeDocument.bookmarks;
                                    this.revealLine(locations.pop());
                                } else {
                                    vscode.workspace.openTextDocument(nextDocument.toString()).then(doc => {
                                        vscode.window.showTextDocument(doc).then(editor => {
                                            let locations = this.manager.activeDocument.bookmarks;
                                            this.revealLine(locations.pop());
                                        });
                                    });
                                }
                            })
                            .catch((error) => {
                                vscode.window.showInformationMessage("No more this.bookmarks...");
                            });
                    } else {
                        this.revealLine(location);
                    }
                })
                .catch((error) => {
                    console.log("activeBookmark.nextBookmark REJECT" + error);
                });
        });

        vscode.commands.registerCommand("metaGo.bookmark.view", () => {
            // no bookmark
            let totalBookmarkCount: number = 0;
            for (let element of this.manager.documents) {
                totalBookmarkCount = totalBookmarkCount + element.bookmarks.length;
            }
            if (totalBookmarkCount === 0) {
                vscode.window.showInformationMessage("No Bookmarks found");
                return;
            }

            // push the items
            let items: vscode.QuickPickItem[] = [];
            let activeTextEditorPath = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri.fsPath : "";
            let promises = [];
            let currentLine: number = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.selection.active.line + 1 : -1;

            for (let index = 0; index < this.manager.documents.length; index++) {
                let bookmark = this.manager.documents[index];
                let pp = bookmark.listBookmarks();
                promises.push(pp);
            }

            Promise.all(promises).then(
                (values) => {
                    for (let index = 0; index < values.length; index++) {
                        let element: BookmarkItem[] = values[index];

                        for (let indexInside = 0; indexInside < element.length; indexInside++) {
                            let elementInside = element[indexInside];

                            if (elementInside.detail.toString().toLowerCase() === activeTextEditorPath.toLowerCase()) {
                                items.push(
                                    new BookmarkItem(elementInside.label,
                                        elementInside.description, null, null, elementInside.location
                                    )
                                );
                            } else {
                                let itemPath = this.removeRootPathFrom(elementInside.detail);
                                items.push(
                                    new BookmarkItem(elementInside.label,
                                        elementInside.description,
                                        itemPath, null, elementInside.location
                                    )
                                );
                            }
                        }

                    }

                    // sort
                    // - active document
                    // - no Octicons - document inside project
                    // - with Octicons - document outside project
                    let itemsSorted: vscode.QuickPickItem[];
                    itemsSorted = items.sort(function (a: vscode.QuickPickItem, b: vscode.QuickPickItem): number {
                        if (!a.detail && !b.detail) {
                            return 0;
                        } else {
                            if (!a.detail && b.detail) {
                                return -1;
                            } else {
                                if (a.detail && !b.detail) {
                                    return 1;
                                } else {
                                    if ((a.detail.toString().indexOf("$(link) ") === 0) && (b.detail.toString().indexOf("$(link) ") === -1)) {
                                        return 1;
                                    } else {
                                        if ((a.detail.toString().indexOf("$(link) ") === -1) && (b.detail.toString().indexOf("$(link) ") === 0)) {
                                            return -1;
                                        } else {
                                            return 0;
                                        }
                                    }
                                }
                            }
                        }
                    });

                    items.push(
                        new BookmarkItem('c',
                            'clear bookmarks in current file',
                            null, 'metaGo.bookmark.clearInFile'
                        )
                    );
                    items.push(
                        new BookmarkItem('cc',
                            'clear all bookmarks in workspace',
                            null, 'metaGo.bookmark.clear'
                        )
                    );
                    items.splice(0, 0,
                        new BookmarkItem('p',
                            'jump to previous bookmark',
                            null, 'metaGo.bookmark.jumpToPrevious'
                        )
                    );
                    items.splice(0, 0,
                        new BookmarkItem('n',
                            'jump to next bookmark',
                            null, 'metaGo.bookmark.jumpToNext'
                        )
                    );

                    let options = <vscode.QuickPickOptions>{
                        placeHolder: "Type a line number or a piece of code to navigate to",
                        matchOnDescription: true,
                        onDidSelectItem: (item: BookmarkItem) => {
                            let filePath: string;
                            if (item.commandId) return;
                            // no detail - previously active document
                            if (!item.detail) {
                                filePath = activeTextEditorPath;
                            } else {
                                // with icon - document outside project
                                if (item.detail.toString().indexOf("$(link) ") === 0) {
                                    filePath = item.detail.toString().split("$(link) ").pop();
                                } else if (item.detail.toString().indexOf("$(tag) ") === 0) {// tag - document inside project
                                    filePath = vscode.workspace.rootPath + item.detail.toString().split("$(tag) ").pop();
                                } else {// no icon
                                    filePath = vscode.workspace.rootPath + item.detail.toString();
                                }
                            }

                            if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.fsPath.toLowerCase() === filePath.toLowerCase()) {
                                this.revealLine(item.location);
                            } else {
                                let uriDocument: vscode.Uri = vscode.Uri.file(filePath);
                                vscode.workspace.openTextDocument(uriDocument).then(doc => {
                                    vscode.window.showTextDocument(doc, undefined, true).then(editor => {
                                        this.revealLine(item.location);
                                    });
                                });
                            }
                        }
                    };
                    vscode.window.showQuickPick(itemsSorted, options).then((selection: BookmarkItem) => {
                        if (typeof selection === "undefined") {
                            if (activeTextEditorPath === "") {
                                return;
                            } else {
                                let uriDocument: vscode.Uri = vscode.Uri.file(activeTextEditorPath);
                                vscode.workspace.openTextDocument(uriDocument).then(doc => {
                                    vscode.window.showTextDocument(doc).then(editor => {
                                        this.revealLine(new Bookmark(currentLine - 1, 0));
                                        return;
                                    });
                                });
                            }
                        }

                        if (typeof selection === "undefined") {
                            return;
                        }

                        if (selection.commandId) {
                            vscode.commands.executeCommand(selection.commandId);
                            return;
                        } else {
                            if (!selection.detail) {
                                this.revealLine(selection.location);
                            } else {
                                let newPath = vscode.workspace.rootPath + selection.detail.toString();
                                let uriDocument: vscode.Uri = vscode.Uri.file(newPath);
                                vscode.workspace.openTextDocument(uriDocument).then(doc => {
                                    vscode.window.showTextDocument(doc).then(editor => {
                                        this.revealLine(selection.location);
                                    });
                                });
                            }
                        }
                    });
                }
            );
        });
    }
}