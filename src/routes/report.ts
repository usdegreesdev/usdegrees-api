import { Router } from "express";
import downloadRouter from "./report/download";
import generateRouter from "./report/generate";
import historyRouter from "./report/history";

const router = Router();

router.use(generateRouter, historyRouter, downloadRouter);

export default router;
