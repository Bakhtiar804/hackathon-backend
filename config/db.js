import mongoose from "mongoose"
import dotenv from "dotenv"

dotenv.config()

const connectDb = async () => {
    try {

        mongoose.connect(process.env.MONGODB_URI);
        console.log("mongoDb connected");
        
    } catch (error) {

        console.log(error);
        console.log("error MongoDB");

    }
}
export default connectDb