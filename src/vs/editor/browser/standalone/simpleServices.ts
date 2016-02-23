/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import {toErrorMessage} from 'vs/base/common/errors';
import {EventEmitter} from 'vs/base/common/eventEmitter';
import {IDisposable} from 'vs/base/common/lifecycle';
import {Schemas} from 'vs/base/common/network';
import Severity from 'vs/base/common/severity';
import {TPromise} from 'vs/base/common/winjs.base';
import {IEditor, IEditorInput, IEditorOptions, IEditorService, IResourceInput, ITextEditorModel, Position} from 'vs/platform/editor/common/editor';
import {KeybindingService} from 'vs/platform/keybinding/browser/keybindingServiceImpl';
import {IOSupport} from 'vs/platform/keybinding/common/keybindingResolver';
import {ICommandHandler, ICommandsMap, IKeybindingItem} from 'vs/platform/keybinding/common/keybindingService';
import {IConfirmation, IMessageService} from 'vs/platform/message/common/message';
import {AbstractPluginService, ActivatedPlugin} from 'vs/platform/plugins/common/abstractPluginService';
import {IPluginDescription} from 'vs/platform/plugins/common/plugins';
import {BaseRequestService} from 'vs/platform/request/common/baseRequestService';
import {ITelemetryService} from 'vs/platform/telemetry/common/telemetry';
import {IWorkspaceContextService} from 'vs/platform/workspace/common/workspace';
import * as editorCommon from 'vs/editor/common/editorCommon';
import {ICodeEditor, IDiffEditor} from 'vs/editor/browser/editorBrowser';

export class SimpleEditor implements IEditor {

	public input:IEditorInput;
	public options:IEditorOptions;
	public position:Position;

	public _widget:editorCommon.IEditor;

	constructor(editor:editorCommon.IEditor) {
		this._widget = editor;
	}

	public getId():string { return 'editor'; }
	public getControl():editorCommon.IEditor { return this._widget; }
	public getSelection():editorCommon.IEditorSelection { return this._widget.getSelection(); }
	public focus():void { this._widget.focus(); }

	public withTypedEditor<T>(codeEditorCallback:(editor:ICodeEditor)=>T, diffEditorCallback:(editor:IDiffEditor)=>T): T {
		if (this._widget.getEditorType() === editorCommon.EditorType.ICodeEditor) {
			// Single Editor
			return codeEditorCallback(<ICodeEditor>this._widget);
		} else {
			// Diff Editor
			return diffEditorCallback(<IDiffEditor>this._widget);
		}
	}
}

export class SimpleModel extends EventEmitter implements ITextEditorModel  {

	private model:editorCommon.IModel;

	constructor(model:editorCommon.IModel) {
		super();
		this.model = model;
	}

	public get textEditorModel():editorCommon.IModel {
		return this.model;
	}
}

export interface IOpenEditorDelegate {
	(url:string): boolean;
}

export class SimpleEditorService implements IEditorService {
	public serviceId = IEditorService;

	private editor:SimpleEditor;
	private openEditorDelegate:IOpenEditorDelegate;

	constructor() {
		this.openEditorDelegate = null;
	}

	public setEditor(editor:editorCommon.IEditor): void {
		this.editor = new SimpleEditor(editor);
	}

	public setOpenEditorDelegate(openEditorDelegate:IOpenEditorDelegate): void {
		this.openEditorDelegate = openEditorDelegate;
	}

	public openEditor(typedData:IResourceInput, sideBySide?:boolean): TPromise<IEditor> {
		return TPromise.as(this.editor.withTypedEditor(
			(editor) => this.doOpenEditor(editor, typedData),
			(diffEditor) => (
				this.doOpenEditor(diffEditor.getOriginalEditor(), typedData) ||
				this.doOpenEditor(diffEditor.getModifiedEditor(), typedData)
			)
		));
	}

	private doOpenEditor(editor:editorCommon.ICommonCodeEditor, data:IResourceInput): IEditor {
		var model = this.findModel(editor, data);
		if (!model) {
			if (data.resource) {
				if (this.openEditorDelegate) {
					this.openEditorDelegate(data.resource.toString());
					return null;
				} else {
					var schema = data.resource.scheme;
					if (schema === Schemas.http || schema === Schemas.https) {
						// This is a fully qualified http or https URL
						window.open(data.resource.toString());
						return this.editor;
					}
				}
			}
			return null;
		}


		var selection = <editorCommon.IRange>data.options.selection;
		if (selection) {
			if (typeof selection.endLineNumber === 'number' && typeof selection.endColumn === 'number') {
				editor.setSelection(selection);
				editor.revealRangeInCenter(selection);
			} else {
				var pos = {
					lineNumber: selection.startLineNumber,
					column: selection.startColumn
				};
				editor.setPosition(pos);
				editor.revealPositionInCenter(pos);
			}
		}

		return this.editor;
	}

	private findModel(editor:editorCommon.ICommonCodeEditor, data:IResourceInput): editorCommon.IModel {
		var model = editor.getModel();
		if(model.getAssociatedResource().toString() !== data.resource.toString()) {
			return null;
		}

		return model;
	}

	public resolveEditorModel(typedData: IResourceInput, refresh?: boolean): TPromise<ITextEditorModel> {
		var model: editorCommon.IModel;

		model = this.editor.withTypedEditor(
			(editor) => this.findModel(editor, typedData),
			(diffEditor) => this.findModel(diffEditor.getOriginalEditor(), typedData) || this.findModel(diffEditor.getModifiedEditor(), typedData)
		);

		if (!model) {
			return TPromise.as(null);
		}

		return TPromise.as(new SimpleModel(model));
	}
}

export class SimpleMessageService implements IMessageService {
	public serviceId = IMessageService;

	private static Empty = function() { /* nothing */};

	public show(sev:Severity, message:any):()=>void {

		switch(sev) {
			case Severity.Error:
				console.error(toErrorMessage(message, true));
				break;
			case Severity.Warning:
				console.warn(message);
				break;
			default:
				console.log(message);
				break;
		}

		return SimpleMessageService.Empty;
	}

	public hideAll():void {
		// No-op
	}

	public confirm(confirmation:IConfirmation):boolean {
		var messageText = confirmation.message;
		if (confirmation.detail) {
			messageText = messageText + '\n\n' + confirmation.detail;
		}

		return window.confirm(messageText);
	}

	public setStatusMessage(message: string, autoDisposeAfter:number = -1): IDisposable {
		return {
			dispose: () => { /* Nothing to do here */ }
		};
	}
}

export class SimpleEditorRequestService extends BaseRequestService {

	constructor(contextService: IWorkspaceContextService, telemetryService?: ITelemetryService) {
		super(contextService, telemetryService);
	}
}

export class StandaloneKeybindingService extends KeybindingService {
	private static LAST_GENERATED_ID = 0;

	private _dynamicKeybindings: IKeybindingItem[];
	private _dynamicCommands: ICommandsMap;

	constructor(domNode: HTMLElement) {
		super();

		this._dynamicKeybindings = [];
		this._dynamicCommands = Object.create(null);

		this._beginListening(domNode);
	}

	public addDynamicKeybinding(keybinding: number, handler:ICommandHandler, context:string, commandId:string = null): string {
		if (commandId === null) {
			commandId = 'DYNAMIC_' + (++StandaloneKeybindingService.LAST_GENERATED_ID);
		}
		var parsedContext = IOSupport.readKeybindingContexts(context);
		this._dynamicKeybindings.push({
			keybinding: keybinding,
			command: commandId,
			context: parsedContext,
			weight1: 1000,
			weight2: 0
		});
		this._dynamicCommands[commandId] = handler;
		this.updateResolver();
		return commandId;
	}

	protected _getExtraKeybindings(isFirstTime:boolean): IKeybindingItem[] {
		return this._dynamicKeybindings;
	}

	protected _getCommandHandler(commandId:string): ICommandHandler {
		return super._getCommandHandler(commandId) || this._dynamicCommands[commandId];
	}
}

export class SimplePluginService extends AbstractPluginService<ActivatedPlugin> {

	constructor() {
		super(true);
	}

	protected _showMessage(severity:Severity, msg:string): void {
		switch (severity) {
			case Severity.Error:
				console.error(msg);
				break;
			case Severity.Warning:
				console.warn(msg);
				break;
			case Severity.Info:
				console.info(msg);
				break;
			default:
				console.log(msg);
		}
	}

	public deactivate(pluginId:string): void {
		// nothing to do
	}

	protected _createFailedPlugin(): ActivatedPlugin {
		throw new Error('unexpected');
	}

	protected _actualActivatePlugin(pluginDescription: IPluginDescription): TPromise<ActivatedPlugin> {
		throw new Error('unexpected');
	}

}
