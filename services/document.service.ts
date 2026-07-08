import api from "@/lib/axios";

export const createDocument = async () => {
  const { data } = await api.post("/document");
  return data;
};

export const getAllDocument = async (filter?: string) => {
  const { data } = await api.get("/document", {
    params: filter ? { filter } : undefined,
  });
  return data;
};

export const getDocument = async (id: string) => {
  const { data } = await api.get(`/document/${id}`);
  return data;
};

export interface UpdateDocumentBody {
  title?: string;
  description?: string;
  content?: Record<string, unknown>;
  visibility?: string;
  status?: string;
  isFavorite?: boolean;
  isArchived?: boolean;
  isDeleted?: boolean;
}

export const updateDocument = async (id: string, body: UpdateDocumentBody) => {
  const { data } = await api.patch(`/document/${id}`, body);
  return data;
};

export const deleteDocument = async (id: string) => {
  const { data } = await api.delete(`/document/${id}`);
  return data;
};