# Use official Node.js image
FROM node:18

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the project
COPY . .

# Expose the port (Railway uses PORT env variable)
EXPOSE 8080

# Start the server
CMD ["npm", "start"]
