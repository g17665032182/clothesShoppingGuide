import type {
  ChatUserInformationService,
  GetMyInformationInput,
  GetMyInformationResponse,
} from '../../chat-user-information/index.js';
import type { PurchaseDraftService } from '../../chat-purchase/index.js';

export type AddressLookupStatus = 'available' | 'empty' | 'unavailable';

type StageAddressSelection = (draftId: string, draftVersion: number) => void;
type DynamicFormPreflightInput = { fields: { key: string }[] };

const EXPLICIT_MANUAL_ENTRY =
  /(?:手动|手工)(?:填写|填|录入)|(?:我来|自己)(?:填写|填|输入)|(?:直接|改为|改成).{0,6}(?:手动|手工)/u;
const RECIPIENT_FIELD_KEYS = new Set([
  'recipient.name',
  'recipient.phone',
  'recipient.address',
]);

export function explicitlyRequestsManualEntry(message: string): boolean {
  return EXPLICIT_MANUAL_ENTRY.test(message);
}

export class PurchaseAddressCoordinator {
  private readonly addressLookups = new Map<
    number,
    Promise<GetMyInformationResponse>
  >();
  private stagedReference: string | null = null;

  public constructor(
    private readonly information: ChatUserInformationService,
    private readonly drafts: PurchaseDraftService,
    private readonly userId: string,
    private readonly conversationId: string,
    private readonly purchaseActive: boolean,
    private readonly currentUserMessage: string,
    private readonly stageAddressSelection: StageAddressSelection,
  ) {}

  public async lookup(
    input: GetMyInformationInput,
  ): Promise<GetMyInformationResponse> {
    const sections: GetMyInformationResponse['sections'] = {};
    const errors: GetMyInformationResponse['errors'] = [];
    const requested = input.sections;

    const others = requested.filter((section) => section !== 'addresses');
    const tasks: Promise<void>[] = [];
    if (requested.includes('addresses')) {
      tasks.push(
        this.lookupAddresses(input.page).then((response) => {
          if (response.sections.addresses)
            sections.addresses = response.sections.addresses;
          errors.push(...response.errors);
        }),
      );
    }
    if (others.length) {
      tasks.push(
        this.information
          .lookup(this.userId, { ...input, sections: others })
          .then((response) => {
            Object.assign(sections, response.sections);
            errors.push(...response.errors);
          }),
      );
    }
    await Promise.all(tasks);
    return { ok: true, sections, errors };
  }

  public async preflightDynamicForm(input: DynamicFormPreflightInput): Promise<{
    ok: false;
    code: 'address_selection_required' | 'information_unavailable';
  } | null> {
    if (
      !this.purchaseActive ||
      !input.fields.some((field) => RECIPIENT_FIELD_KEYS.has(field.key)) ||
      explicitlyRequestsManualEntry(this.currentUserMessage)
    ) {
      return null;
    }

    let state: Awaited<ReturnType<PurchaseDraftService['dynamicFormState']>>;
    try {
      state = await this.drafts.dynamicFormState(
        this.userId,
        this.conversationId,
      );
    } catch {
      return null;
    }
    const recipient = state.draft.recipient;
    if (
      recipient.name?.trim() &&
      recipient.phone?.trim() &&
      recipient.address?.trim()
    ) {
      return null;
    }

    return this.gateFromAddressLookup();
  }

  private async gateFromAddressLookup(): Promise<{
    ok: false;
    code: 'address_selection_required' | 'information_unavailable';
  } | null> {
    const result = await this.lookupAddresses(1);
    if (
      result.errors.some((error) => error.section === 'addresses') ||
      !result.sections.addresses
    ) {
      return explicitlyRequestsManualEntry(this.currentUserMessage)
        ? null
        : { ok: false, code: 'information_unavailable' };
    }

    if (result.sections.addresses.total === 0) return null;
    const state = await this.readCurrentDraft();
    if (!state) return null;
    this.stageOnce(state.draft.id, state.draft.version);
    return { ok: false, code: 'address_selection_required' };
  }

  private async lookupAddresses(
    page: number,
  ): Promise<GetMyInformationResponse> {
    let lookup = this.addressLookups.get(page);
    if (!lookup) {
      lookup = this.information.lookup(this.userId, {
        sections: ['addresses'],
        page,
      });
      this.addressLookups.set(page, lookup);
    }
    const response = await lookup;
    await this.stageFromAddressResponse(response);
    return response;
  }

  private async stageFromAddressResponse(
    response: GetMyInformationResponse,
  ): Promise<void> {
    if (
      !this.purchaseActive ||
      explicitlyRequestsManualEntry(this.currentUserMessage) ||
      !response.sections.addresses
    ) {
      return;
    }
    if (
      response.errors.some((error) => error.section === 'addresses') ||
      response.sections.addresses.total === 0
    ) {
      return;
    }
    const state = await this.readCurrentDraft();
    if (!state) return;
    const recipient = state.draft.recipient;
    if (
      recipient.name?.trim() &&
      recipient.phone?.trim() &&
      recipient.address?.trim()
    ) {
      return;
    }
    this.stageOnce(state.draft.id, state.draft.version);
  }

  private async readCurrentDraft() {
    try {
      return await this.drafts.dynamicFormState(
        this.userId,
        this.conversationId,
      );
    } catch {
      return null;
    }
  }

  private stageOnce(draftId: string, draftVersion: number): void {
    const key = `${draftId}:${draftVersion}`;
    if (this.stagedReference === key) return;
    this.stagedReference = key;
    this.stageAddressSelection(draftId, draftVersion);
  }
}
