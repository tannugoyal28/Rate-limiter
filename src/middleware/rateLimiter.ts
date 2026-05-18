import { Request , Response , NextFunction } from "express";

export function createRateLimiterMiddleware (){
    return async(req:Request , res:Response , next: NextFunction) => {
        
        next();
    }
}