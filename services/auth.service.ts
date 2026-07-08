import api from "@/lib/axios";

export interface LoginBody {
  email: string;
  password: string;
}

export const login = async (body: LoginBody) => {
  const { data } = await api.post("/auth/signin", body);

  return data;
};

export interface SignupBody {
  name: string;
  email: string;
  password: string;
}

export const signup = async (body: SignupBody) => {
  const { data } = await api.post("/auth/signup", body);

  return data;
};

export const logout = async () => {
  const { data } = await api.post("/auth/logout");

  return data;
};