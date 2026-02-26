import type {
  AiAgentMessage,
  AiAgentResponse,
  AiAgentUsage
} from '@ghostfolio/common/interfaces';
import { DataService } from '@ghostfolio/ui/services';

import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  NgZone,
  OnDestroy,
  OnInit
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { marked } from 'marked';
import { Subject, takeUntil } from 'rxjs';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  contentHtml?: SafeHtml;
  timestamp: string;
  traceId?: string;
  toolCalls?: AiAgentResponse['toolCalls'];
  confidence?: number;
  disclaimers?: string[];
  sources?: AiAgentResponse['sources'];
  usage?: AiAgentUsage;
  durationMs?: number;
  feedbackGiven?: 'up' | 'down' | null;
  showCorrectionInput?: boolean;
  correctionText?: string;
}

@Component({
  host: { class: 'page' },
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule
  ],
  selector: 'gf-ai-agent-page',
  standalone: true,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        height: calc(100vh - 64px);
        padding: 1rem;
      }

      .chat-container {
        display: flex;
        flex-direction: column;
        flex: 1;
        overflow: hidden;
        max-width: 900px;
        margin: 0 auto;
        width: 100%;
      }

      .messages {
        flex: 1;
        overflow-y: auto;
        padding: 1rem 0;
      }

      .message {
        margin-bottom: 1rem;
        padding: 0.75rem 1rem;
        border-radius: 8px;
        max-width: 85%;
        word-wrap: break-word;
      }

      .message.user {
        white-space: pre-wrap;
        background-color: rgba(var(--dark-dividers));
        margin-left: auto;
        text-align: right;
        color: rgba(var(--dark-primary-text));
      }

      .message.assistant {
        background-color: rgba(var(--dark-focused));
        border: 1px solid rgba(var(--dark-dividers));
        margin-right: auto;
        color: rgba(var(--dark-primary-text));
      }

      :host-context(.theme-dark) .message.user {
        background-color: rgba(255, 255, 255, 0.12);
        color: #ffffff;
      }

      :host-context(.theme-dark) .message.assistant {
        background-color: rgba(255, 255, 255, 0.05);
        border-color: rgba(255, 255, 255, 0.12);
        color: #e0e0e0;
      }

      :host-context(.theme-dark) .message.assistant .markdown-body,
      :host-context(.theme-dark) .message.assistant .markdown-body * {
        color: inherit;
      }

      .tool-calls {
        margin-top: 0.5rem;
        font-size: 0.85rem;
      }

      .tool-call-entry {
        margin-bottom: 0.5rem;
        padding-bottom: 0.5rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }

      .tool-timing {
        font-size: 0.75rem;
        opacity: 0.6;
        margin-left: 0.5rem;
      }

      .tool-result {
        max-height: 200px;
        overflow-y: auto;
        font-size: 0.8rem;
      }

      .message-stats {
        font-size: 0.75rem;
        opacity: 0.6;
        margin-top: 0.5rem;
        display: flex;
        gap: 0.75rem;
        align-items: center;
      }

      .confidence {
        font-size: 0.8rem;
        margin-top: 0.25rem;
        border-left: 3px solid;
        padding: 0.25rem 0.5rem;
        display: flex;
        gap: 0.5rem;
        align-items: center;
      }

      .confidence-label {
        font-weight: 500;
      }

      .confidence-value {
        opacity: 0.7;
      }

      .contextual-disclaimers {
        margin-top: 0.5rem;
        border-left: 3px solid #f59e0b;
        padding: 0.25rem 0.5rem;
      }

      .disclaimers-summary {
        font-size: 0.8rem;
        cursor: pointer;
        opacity: 0.8;
        font-weight: 500;
      }

      .contextual-disclaimer {
        font-size: 0.8rem;
        font-style: italic;
        opacity: 0.8;
        margin-bottom: 0.25rem;
      }

      .contextual-disclaimer:last-child {
        margin-bottom: 0;
      }

      .sources {
        font-size: 0.8rem;
        opacity: 0.6;
        margin-top: 0.25rem;
      }

      .feedback-area {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        margin-top: 0.5rem;
      }

      .feedback-btn {
        min-width: 32px;
        width: 32px;
        height: 32px;
        padding: 0;
        font-size: 1rem;
        line-height: 32px;
        cursor: pointer;
      }

      .feedback-area .feedback-active {
        opacity: 1;
      }

      .feedback-area .feedback-inactive {
        opacity: 0.4;
      }

      .feedback-submitted {
        font-size: 0.75rem;
        opacity: 0.6;
        margin-left: 0.5rem;
      }

      .correction-input {
        margin-top: 0.5rem;
        display: flex;
        gap: 0.5rem;
        align-items: flex-end;
      }

      .correction-input mat-form-field {
        flex: 1;
        font-size: 0.85rem;
      }

      .disclaimer {
        font-size: 0.75rem;
        opacity: 0.5;
        font-style: italic;
        text-align: center;
        padding: 0.5rem;
        border-top: 1px solid rgba(var(--dark-dividers));
      }

      :host-context(.theme-dark) .disclaimer {
        border-top-color: rgba(var(--light-dividers));
        color: rgba(255, 255, 255, 0.9);
        opacity: 1;
      }

      :host-context(.theme-dark) .confidence {
        color: rgba(255, 255, 255, 0.85);
      }

      :host-context(.theme-dark) .contextual-disclaimers {
        color: rgba(255, 255, 255, 0.85);
      }

      :host-context(.theme-dark) .sources {
        color: rgba(255, 255, 255, 0.85);
        opacity: 1;
      }

      :host-context(.theme-dark) .message-stats {
        color: rgba(255, 255, 255, 0.6);
        opacity: 1;
      }

      .input-area {
        display: flex;
        gap: 0.5rem;
        padding: 1rem 0;
        align-items: flex-end;
      }

      .input-area mat-form-field {
        flex: 1;
      }

      .loading {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem;
        opacity: 0.7;
      }

      h1 {
        margin: 0 0 0.5rem 0;
        font-size: 1.5rem;
      }
    `,
    `
      :host ::ng-deep .markdown-body h1,
      :host ::ng-deep .markdown-body h2,
      :host ::ng-deep .markdown-body h3 {
        margin: 0.75rem 0 0.5rem;
        font-weight: 600;
      }

      :host ::ng-deep .markdown-body h2 { font-size: 1.2rem; }
      :host ::ng-deep .markdown-body h3 { font-size: 1.05rem; }

      :host ::ng-deep .markdown-body p {
        margin: 0.4rem 0;
      }

      :host ::ng-deep .markdown-body ul,
      :host ::ng-deep .markdown-body ol {
        padding-left: 1.5rem;
        margin: 0.4rem 0;
      }

      :host ::ng-deep .markdown-body table {
        border-collapse: collapse;
        width: 100%;
        margin: 0.5rem 0;
      }

      :host ::ng-deep .markdown-body th,
      :host ::ng-deep .markdown-body td {
        border: 1px solid rgba(255, 255, 255, 0.2);
        padding: 0.4rem 0.6rem;
        text-align: left;
      }

      :host ::ng-deep .markdown-body th {
        font-weight: 600;
      }

      :host ::ng-deep .markdown-body hr {
        border: none;
        border-top: 1px solid rgba(255, 255, 255, 0.2);
        margin: 0.75rem 0;
      }

      :host ::ng-deep .markdown-body strong {
        font-weight: 600;
      }
    `
  ],
  template: `
    <div class="chat-container">
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <h1 i18n>AI Agent</h1>
        <button
          mat-button
          (click)="newConversation()"
          [disabled]="isLoading"
          i18n
        >
          New Conversation
        </button>
      </div>

      <div class="messages">
        @if (isLoadingConversation) {
          <div class="loading">
            <mat-spinner diameter="20"></mat-spinner>
            <span i18n>Loading conversation...</span>
          </div>
        }
        @for (msg of messages; track msg.timestamp) {
          <div class="message" [class]="msg.role">
            @if (msg.role === 'assistant' && msg.contentHtml) {
              <div class="markdown-body" [innerHTML]="msg.contentHtml"></div>
            } @else {
              <div>{{ msg.content }}</div>
            }

            @if (msg.toolCalls?.length) {
              <mat-expansion-panel class="tool-calls">
                <mat-expansion-panel-header>
                  <mat-panel-title>
                    Tool Calls ({{ msg.toolCalls.length }})
                  </mat-panel-title>
                </mat-expansion-panel-header>
                @for (tc of msg.toolCalls; track tc.toolName) {
                  <div class="tool-call-entry">
                    <strong>{{ tc.toolName }}</strong>
                    @if (tc.durationMs) {
                      <span class="tool-timing">{{ tc.durationMs }}ms</span>
                    }
                    <pre>{{ tc.args | json }}</pre>
                    @if (tc.result) {
                      <details>
                        <summary>Result</summary>
                        <pre class="tool-result">{{ truncateResult(tc.result) }}</pre>
                      </details>
                    }
                  </div>
                }
              </mat-expansion-panel>
            }

            @if (msg.role === 'assistant' && msg.usage) {
              <div class="message-stats">
                <span>{{ msg.usage.totalTokens }} tokens</span>
                @if (msg.durationMs) {
                  <span>{{ (msg.durationMs / 1000).toFixed(1) }}s</span>
                }
                @if (msg.toolCalls?.length) {
                  <span>{{ msg.toolCalls.length }} tool calls</span>
                }
                @if (msg.usage.cost) {
                  <span>\${{ msg.usage.cost.toFixed(4) }}</span>
                }
              </div>
            }

            @if (msg.disclaimers?.length) {
              <details class="contextual-disclaimers">
                <summary class="disclaimers-summary">Notes ({{ msg.disclaimers.length }})</summary>
                @for (d of msg.disclaimers; track d) {
                  <div class="contextual-disclaimer">{{ d }}</div>
                }
              </details>
            }

            @if (msg.confidence !== undefined) {
              <div class="confidence" [style.border-left-color]="getConfidenceColor(msg.confidence)">
                <span class="confidence-label">{{ getConfidenceLabel(msg.confidence) }}</span>
                <span class="confidence-value">{{ (msg.confidence * 100).toFixed(0) }}%</span>
              </div>
            }

            @if (msg.sources?.length) {
              <div class="sources">
                Sources:
                @for (src of msg.sources; track src.service) {
                  {{ src.service }}
                }
              </div>
            }

            @if (msg.role === 'assistant' && msg.traceId) {
              <div class="feedback-area">
                @if (msg.feedbackGiven === undefined || msg.feedbackGiven === null) {
                  <button
                    mat-button
                    (click)="submitFeedback(msg, 'up')"
                    title="Helpful"
                    class="feedback-btn"
                  >
                    &#x1F44D;
                  </button>
                  <button
                    mat-button
                    (click)="submitFeedback(msg, 'down')"
                    title="Not helpful"
                    class="feedback-btn"
                  >
                    &#x1F44E;
                  </button>
                } @else {
                  <button
                    mat-button
                    disabled
                    class="feedback-btn"
                    [class.feedback-active]="msg.feedbackGiven === 'up'"
                    [class.feedback-inactive]="msg.feedbackGiven !== 'up'"
                  >
                    &#x1F44D;
                  </button>
                  <button
                    mat-button
                    disabled
                    class="feedback-btn"
                    [class.feedback-active]="msg.feedbackGiven === 'down'"
                    [class.feedback-inactive]="msg.feedbackGiven !== 'down'"
                  >
                    &#x1F44E;
                  </button>
                  <span class="feedback-submitted">Feedback submitted</span>
                }
              </div>
              @if (msg.showCorrectionInput) {
                <div class="correction-input">
                  <mat-form-field appearance="outline">
                    <mat-label i18n>What would be a better response?</mat-label>
                    <input
                      matInput
                      [(ngModel)]="msg.correctionText"
                      (keydown.enter)="submitCorrection(msg)"
                    />
                  </mat-form-field>
                  <button
                    mat-raised-button
                    color="primary"
                    (click)="submitCorrection(msg)"
                    [disabled]="!msg.correctionText?.trim()"
                    i18n
                  >
                    Send
                  </button>
                </div>
              }
            }
          </div>
        }

        @if (isLoading && !messages[messages.length - 1]?.content) {
          <div class="loading">
            <mat-spinner diameter="20"></mat-spinner>
            <span i18n>Thinking...</span>
          </div>
        }
      </div>

      <div class="disclaimer" i18n>
        This AI assistant is for educational purposes only and does not
        constitute financial advice. Consult a qualified financial advisor.
      </div>

      <div class="input-area">
        <mat-form-field appearance="outline">
          <mat-label i18n>Ask about your portfolio...</mat-label>
          <input
            matInput
            [(ngModel)]="userMessage"
            (keydown.enter)="sendMessage()"
            [disabled]="isLoading"
          />
        </mat-form-field>
        <button
          mat-raised-button
          color="primary"
          (click)="sendMessage()"
          [disabled]="isLoading || !userMessage?.trim()"
          i18n
        >
          Send
        </button>
      </div>
    </div>
  `
})
export class GfAiAgentPageComponent implements OnInit, OnDestroy {
  public conversationId: string | null = null;
  public isLoading = false;
  public isLoadingConversation = true;
  public messages: ChatMessage[] = [];
  public userMessage = '';

  private unsubscribeSubject = new Subject<void>();

  public constructor(
    private changeDetectorRef: ChangeDetectorRef,
    private dataService: DataService,
    private ngZone: NgZone,
    private sanitizer: DomSanitizer
  ) {}

  public ngOnInit() {
    this.loadConversation();
  }

  public newConversation() {
    this.dataService
      .createAiAgentConversation()
      .pipe(takeUntil(this.unsubscribeSubject))
      .subscribe({
        next: (conversation) => {
          this.conversationId = conversation.id;
          this.messages = [];
          this.changeDetectorRef.markForCheck();
        },
        error: () => {
          // Fall back to in-memory only
          this.conversationId = null;
          this.messages = [];
        }
      });
  }

  public sendMessage() {
    const message = this.userMessage?.trim();
    if (!message || this.isLoading) {
      return;
    }

    this.messages.push({
      role: 'user',
      content: message,
      timestamp: new Date().toISOString()
    });

    this.userMessage = '';
    this.isLoading = true;

    // When we have a conversationId, server loads history from DB
    const conversationHistory: AiAgentMessage[] = this.conversationId
      ? []
      : this.messages.slice(0, -1).map((m) => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp
        }));

    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString()
    };
    this.messages.push(assistantMessage);

    this.dataService
      .postAiAgentChatStream({
        conversationHistory,
        conversationId: this.conversationId ?? undefined,
        message
      })
      .pipe(takeUntil(this.unsubscribeSubject))
      .subscribe({
        next: ({ text, traceId, conversationId: respConvId, done, toolCalls, confidence, disclaimers }) => {
          this.ngZone.run(() => {
            assistantMessage.content = text;
            assistantMessage.contentHtml =
              this.sanitizer.bypassSecurityTrustHtml(
                marked(text) as string
              );

            if (done) {
              assistantMessage.traceId = traceId;
              assistantMessage.feedbackGiven = null;
              if (respConvId && !this.conversationId) {
                this.conversationId = respConvId;
              }
              if (toolCalls?.length) {
                assistantMessage.toolCalls = toolCalls;
              }
              if (confidence !== undefined) {
                assistantMessage.confidence = confidence;
              }
              if (disclaimers?.length) {
                assistantMessage.disclaimers = disclaimers;
              }
              this.isLoading = false;
            }

            this.changeDetectorRef.markForCheck();
          });
        },
        error: () => {
          this.ngZone.run(() => {
            assistantMessage.content =
              'Sorry, I encountered an error processing your request. Please try again.';
            assistantMessage.contentHtml = undefined;
            this.isLoading = false;
          });
        }
      });
  }

  public submitFeedback(msg: ChatMessage, rating: 'up' | 'down') {
    if (!msg.traceId || msg.feedbackGiven) {
      return;
    }

    if (rating === 'down') {
      msg.showCorrectionInput = true;
    }

    this.dataService
      .postAiAgentFeedback({ traceId: msg.traceId, rating })
      .pipe(takeUntil(this.unsubscribeSubject))
      .subscribe({
        next: () => {
          msg.feedbackGiven = rating;
          if (rating === 'up') {
            msg.showCorrectionInput = false;
          }
        },
        error: () => {
          // Silently fail — feedback is non-critical
        }
      });
  }

  public submitCorrection(msg: ChatMessage) {
    const correction = msg.correctionText?.trim();
    if (!msg.traceId || !correction) {
      return;
    }

    this.dataService
      .postAiAgentFeedback({
        traceId: msg.traceId,
        rating: 'down',
        correction
      })
      .pipe(takeUntil(this.unsubscribeSubject))
      .subscribe({
        next: () => {
          msg.showCorrectionInput = false;
          msg.feedbackGiven = 'down';
        },
        error: () => {
          // Silently fail
        }
      });
  }

  public truncateResult(result: unknown): string {
    const json = JSON.stringify(result, null, 2);

    if (json.length <= 500) {
      return json;
    }

    return json.slice(0, 500) + '\n...';
  }

  public getConfidenceColor(confidence: number): string {
    if (confidence >= 0.85) {
      return '#4caf50';
    }

    if (confidence >= 0.65) {
      return '#ff9800';
    }

    return '#f44336';
  }

  public getConfidenceLabel(confidence: number): string {
    if (confidence >= 0.85) {
      return 'High confidence';
    }

    if (confidence >= 0.65) {
      return 'Moderate confidence';
    }

    return 'Low confidence';
  }

  public ngOnDestroy() {
    this.unsubscribeSubject.next();
    this.unsubscribeSubject.complete();
  }

  private loadConversation() {
    this.isLoadingConversation = true;

    this.dataService
      .getAiAgentConversation()
      .pipe(takeUntil(this.unsubscribeSubject))
      .subscribe({
        next: (conversation) => {
          this.conversationId = conversation.id;

          if (conversation.messages?.length) {
            this.messages = conversation.messages.map((m) => ({
              role: m.role as 'user' | 'assistant',
              content: m.content,
              contentHtml:
                m.role === 'assistant'
                  ? this.sanitizer.bypassSecurityTrustHtml(
                      marked(m.content) as string
                    )
                  : undefined,
              timestamp: m.createdAt,
              traceId: m.traceId ?? undefined,
              feedbackGiven: m.traceId ? null : undefined
            }));
          }

          this.isLoadingConversation = false;
          this.changeDetectorRef.markForCheck();
        },
        error: () => {
          this.isLoadingConversation = false;
          this.changeDetectorRef.markForCheck();
        }
      });
  }
}
