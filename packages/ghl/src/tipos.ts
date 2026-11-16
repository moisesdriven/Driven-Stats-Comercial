/**
 * Tipos de las respuestas de GHL usadas (verificados en la documentación oficial y con datos reales
 * de la subcuenta piloto, docs/mapeo-origen.md). Solo se tipan los campos que se usan.
 */
export interface MensajeGhl {
  id: string;
  type?: number;
  messageType?: string;
  locationId: string;
  contactId?: string;
  conversationId: string;
  dateAdded: string;
  body?: string;
  direction: 'inbound' | 'outbound';
  status?: string;
  contentType?: string;
  attachments?: string[];
  source?: string;
  userId?: string;
  activity?: {
    type?: string;
    title?: string;
    data?: {
      id?: string;
      status?: string;
      pipeline?: string;
      stage?: { oldStageName?: string; newStageName?: string };
    };
  };
}

export interface ConversacionGhl {
  id: string;
  contactId: string;
  locationId: string;
  assignedTo?: string;
  lastMessageDate?: number;
  lastMessageType?: string;
  lastMessageDirection?: string;
  dateAdded?: number;
  dateUpdated?: number;
  type?: string;
  sort?: number[];
}

export interface OportunidadGhl {
  id: string;
  name?: string;
  monetaryValue?: number;
  pipelineId?: string;
  pipelineStageId?: string;
  assignedTo?: string;
  status: 'open' | 'won' | 'lost' | 'abandoned';
  source?: string;
  lastStatusChangeAt?: string;
  lastStageChangeAt?: string;
  createdAt?: string;
  updatedAt?: string;
  contactId?: string;
  locationId?: string;
  lostReasonId?: string;
}

export interface PipelineGhl {
  id: string;
  name: string;
  stages: { id: string; name: string; position?: number }[];
}

export interface UsuarioGhl {
  id: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  deleted?: boolean;
  roles?: { type?: string; role?: string; locationIds?: string[] };
}

export interface MotivoPerdidaGhl {
  id: string;
  name: string;
}

export interface TareaGhl {
  id?: string;
  _id?: string;
  contactId?: string;
  dueDate?: string;
  completed?: boolean;
  title?: string;
  assignedTo?: string;
}

export interface SubcuentaGhl {
  id: string;
  name: string;
  timezone?: string;
  companyId?: string;
}
