/*
 * Copyright (C) 2018 TypeFox
 * 
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
 */

import { injectable, inject, optional } from "inversify";
import {
    LocalModelSource, ComputedBoundsAction, TYPES, IActionDispatcher, ActionHandlerRegistry, ViewerOptions,
    PopupModelFactory, IStateAwareModelProvider, SGraphSchema, ILogger, SelectAction, CenterAction
} from "sprotty/lib";
import { IGraphGenerator } from "./graph-generator";
import { ElkGraphLayout } from "./graph-layout";
import { DependencyGraphNodeSchema } from "./graph-model";

@injectable()
export class DepGraphModelSource extends LocalModelSource {

    private pendingSelection: string[] = [];
    private pendingCenter: string[] = [];

    loadIndicator?: (loadStatus: boolean) => void;

    constructor(@inject(TYPES.IActionDispatcher) actionDispatcher: IActionDispatcher,
        @inject(TYPES.ActionHandlerRegistry) actionHandlerRegistry: ActionHandlerRegistry,
        @inject(TYPES.ViewerOptions) viewerOptions: ViewerOptions,
        @inject(IGraphGenerator) public readonly graphGenerator: IGraphGenerator,
        @inject(ElkGraphLayout) protected readonly elk: ElkGraphLayout,
        @inject(TYPES.ILogger) protected readonly logger: ILogger,
        @inject(TYPES.PopupModelFactory)@optional() popupModelFactory?: PopupModelFactory,
        @inject(TYPES.StateAwareModelProvider)@optional() modelProvider?: IStateAwareModelProvider
    ) {
        super(actionDispatcher, actionHandlerRegistry, viewerOptions, popupModelFactory, modelProvider);
        this.onModelSubmitted = (newRoot) => {
            if (this.loadIndicator) {
                this.loadIndicator(false);
            }
            const selection = this.pendingSelection;
            if (selection.length > 0) {
                this.actionDispatcher.dispatch(new SelectAction(selection));
                this.pendingSelection = [];
            }
            const center = this.pendingCenter;
            if (center.length > 0) {
                this.actionDispatcher.dispatch(new CenterAction(center));
                this.pendingCenter = [];
            }
        };
    }

    start(): void {
        this.setModel(this.graphGenerator.graph);
    }

    createNode(name: string, version?: string): void {
        const node = this.graphGenerator.generateNode(name, version);
        this.pendingSelection.push(node.id);
        this.updateModel();
    }

    async resolveNodes(nodes: DependencyGraphNodeSchema[]): Promise<void> {
        if (this.loadIndicator) {
            this.loadIndicator(true);
        }
        for (const node of nodes) {
            try {
                await this.graphGenerator.resolveNode(node);
            } catch (error) {
                node.error = error.toString();
            }
            this.pendingCenter.push(node.id);
        }
        this.updateModel();
    }

    protected handleComputedBounds(action: ComputedBoundsAction): void {
        const root = this.currentRoot;
        const index = this.graphGenerator.index;
        for (const b of action.bounds) {
            const element = index.getById(b.elementId);
            if (element !== undefined)
                this.applyBounds(element, b.newBounds);
        }
        if (action.alignments !== undefined) {
            for (const a of action.alignments) {
                const element = index.getById(a.elementId);
                if (element !== undefined)
                    this.applyAlignment(element, a.newAlignment);
            }
        }

        // Compute a layout with elkjs
        this.elk.layout(root as SGraphSchema, index).then(() => {
            this.doSubmitModel(root, true);
        }).catch(error => {
            this.logger.error(this, error.toString());
            this.doSubmitModel(root, true);
        });
    }

}